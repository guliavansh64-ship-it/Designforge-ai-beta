import { normalizeStitchModel } from '@designforge/shared';
import { Router } from 'express';
import { z } from 'zod';
import { auth, db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { getEntitlements } from '../services/plans.js';
import { getBalance } from '../services/credits.js';
import { listConnectionStatus } from '../services/connections.js';
import { zipFiles } from '../services/exporter.js';
import { invalidateAuthCache } from '../middleware/auth.js';

export const meRouter = Router();

/** Upserts the profile on every call (first call = registration). */
meRouter.get('/me', ah(async (req, res) => {
  const u = req.user!;
  const ref = db().collection(C.users).doc(u.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ uid: u.uid, email: u.email ?? null, displayName: u.name ?? null, photoURL: u.picture ?? null, status: 'active', createdAt: Date.now(), lastSeenAt: Date.now() });
    const { track, notify } = await import('../services/notify.js');
    await track('registrations');
    // In-app welcome now; its push arrives once the device registers its token on first launch.
    await notify(u.uid, 'welcome', 'Welcome to DesignForge AI 🎉', 'Connect Stitch in Integrations, then describe any app — e.g. "create a fitness app" — and we design every screen for you.').catch(() => undefined);
  } else {
    await ref.update({ lastSeenAt: Date.now(), email: u.email ?? snap.get('email') ?? null, photoURL: u.picture ?? snap.get('photoURL') ?? null });
  }
  const [profile, ent, balance, connections, prefs] = await Promise.all([
    ref.get(), getEntitlements(u.uid), getBalance(u.uid), listConnectionStatus(u.uid), db().collection(C.prefs).doc(u.uid).get(),
  ]);
  const p = profile.data()!;
  res.json({
    user: { uid: u.uid, email: p.email, displayName: p.displayName, photoURL: p.photoURL, createdAt: p.createdAt, isAdmin: !!u.adminRole, adminRole: u.adminRole ?? null },
    plan: ent.plan, subscription: ent.sub, credits: balance, connections,
    preferences: (() => {
      const pr = prefs.data() ?? { theme: 'system', defaultDevice: 'DESKTOP', notificationPrefs: { push: true, email: false } };
      return { ...pr, defaultModel: normalizeStitchModel(pr.defaultModel) };
    })(),
  });
}));

meRouter.patch('/me', validate(z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  preferences: z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    defaultDevice: z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']).optional(),
    defaultModel: z.string().max(40).optional().transform((m) => (m === undefined ? undefined : normalizeStitchModel(m))),
    notificationPrefs: z.object({ push: z.boolean(), email: z.boolean() }).partial().optional(),
  }).optional(),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  if (req.body.displayName) {
    await db().collection(C.users).doc(uid).update({ displayName: req.body.displayName });
    await auth().updateUser(uid, { displayName: req.body.displayName });
  }
  if (req.body.preferences) {
    await db().collection(C.prefs).doc(uid).set({ ownerId: uid, ...req.body.preferences }, { merge: true });
    if (req.body.preferences.notificationPrefs) await db().collection(C.users).doc(uid).set({ notificationPrefs: req.body.preferences.notificationPrefs }, { merge: true });
  }
  res.json({ ok: true });
}));

// Native FCM registration token (Android) or a legacy Expo push token.
meRouter.post('/me/push-token', validate(z.object({ token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:\-\[\]]+$/), kind: z.enum(['fcm', 'expo']).optional() })), ah(async (req, res) => {
  const isExpo = /^ExponentPushToken\[/.test(req.body.token);
  const field = isExpo ? 'expoPushTokens' : 'fcmTokens';
  const ref = db().collection(C.users).doc(req.user!.uid);
  // A device belongs to whoever is signed in on it now: detach the token from any other account.
  const others = await db().collection(C.users).where(field, 'array-contains', req.body.token).limit(10).get().catch(() => null);
  const { FieldValue } = await import('../lib/firebase.js');
  for (const d of others?.docs ?? []) if (d.id !== req.user!.uid) await d.ref.update({ [field]: FieldValue.arrayRemove(req.body.token) }).catch(() => undefined);
  // Keep at most 5 devices per user (newest wins).
  const cur: string[] = ((await ref.get()).get(field) ?? []).filter((t: string) => t !== req.body.token);
  await ref.set({ [field]: [...cur.slice(-4), req.body.token], pushUpdatedAt: Date.now() }, { merge: true });
  res.json({ ok: true });
}));

/**
 * Test push, sent 15 s later so the user can CLOSE the app first and confirm that notifications
 * arrive while it isn't running. At most one every 30 s per user.
 */
const lastTest = new Map<string, number>();
meRouter.post('/me/push-test', ah(async (req, res) => {
  const uid = req.user!.uid;
  if (Date.now() - (lastTest.get(uid) ?? 0) < 30_000) { res.json({ ok: true, queued: false, wait: true }); return; }
  lastTest.set(uid, Date.now());
  const snap = await db().collection(C.users).doc(uid).get();
  const devices = (snap.get('fcmTokens') ?? []).length + (snap.get('expoPushTokens') ?? []).length;
  if (!devices) { res.json({ ok: false, devices: 0 }); return; }
  const { pushToUser } = await import('../services/notify.js');
  setTimeout(() => {
    pushToUser(uid, 'Test notification ✅', 'Push works even when DesignForge is closed. You will be notified when your designs are ready.', { type: 'test', kind: 'notifications' }, { respectPrefs: false }).catch(() => undefined);
  }, 15_000).unref?.();
  res.json({ ok: true, queued: true, devices, inSeconds: 15 });
}));

meRouter.delete('/me/push-token', validate(z.object({ token: z.string() })), ah(async (req, res) => {
  const { FieldValue } = await import('../lib/firebase.js');
  await db().collection(C.users).doc(req.user!.uid).set({ expoPushTokens: FieldValue.arrayRemove(req.body.token), fcmTokens: FieldValue.arrayRemove(req.body.token) }, { merge: true });
  res.json({ ok: true });
}));

/** Sign out of all devices (revokes refresh tokens; ID tokens fail checkRevoked immediately). */
meRouter.post('/me/logout-all', ah(async (req, res) => {
  await auth().revokeRefreshTokens(req.user!.uid);
  invalidateAuthCache(req.user!.uid);
  res.json({ ok: true });
}));

const OWNED = [C.projects, C.versions, C.jobs, C.generations, C.notifications, C.tickets, C.connections, C.chat, C.assets] as const;

/** GDPR-style data export (JSON files in a ZIP). Never includes encrypted credentials. */
meRouter.get('/me/export', ah(async (req, res) => {
  const uid = req.user!.uid;
  const files: Record<string, string> = {};
  for (const col of [...OWNED, C.creditTxns, C.payments]) {
    const snap = await db().collection(col).where('ownerId', '==', uid).limit(5000).get();
    files[`${col}.json`] = JSON.stringify(snap.docs.map((d) => {
      // Internal fields (enhanced prompts sent to Stitch, push tokens) are not part of the export.
      const { encryptedKey, plan, payload, paymentUrl, ...rest } = d.data();
      return { id: d.id, ...rest };
    }), null, 2);
  }
  const { fcmTokens, expoPushTokens, ...profile } = (await db().collection(C.users).doc(uid).get()).data() ?? {};
  files['profile.json'] = JSON.stringify(profile, null, 2);
  const zip = await zipFiles(files, 'designforge-data-export');
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-disposition', 'attachment; filename="designforge-data-export.zip"');
  res.send(zip);
}));

/** Account deletion: removes owned data, credentials and the auth user. Payment records are retained (anonymised) for tax law. */
meRouter.delete('/me', validate(z.object({ confirm: z.literal('DELETE') })), ah(async (req, res) => {
  const uid = req.user!.uid;
  for (const col of OWNED) {
    while (true) {
      const snap = await db().collection(col).where('ownerId', '==', uid).limit(300).get();
      if (snap.empty) break;
      const batch = db().batch();
      for (const d of snap.docs) {
        if (col === C.assets) { const ch = await d.ref.collection('chunks').get(); ch.docs.forEach((c) => batch.delete(c.ref)); }
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  }
  const pays = await db().collection(C.payments).where('ownerId', '==', uid).get();
  const b = db().batch();
  pays.docs.forEach((d) => b.update(d.ref, { ownerId: `deleted_${uid.slice(0, 6)}`, anonymisedAt: Date.now() }));
  [C.users, C.prefs, C.wallets, C.subscriptions].forEach((col) => b.delete(db().collection(col).doc(uid)));
  await b.commit();
  await auth().deleteUser(uid);
  res.json({ ok: true });
}));
