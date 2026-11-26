import { db, C, FieldValue, messaging } from '../lib/firebase.js';
import { logger } from '../lib/logger.js';

export type NotificationType =
  | 'generation_completed' | 'generation_failed' | 'credits_low' | 'subscription_renewed'
  | 'subscription_expiring' | 'subscription_expired' | 'payment_success' | 'payment_failed'
  | 'announcement' | 'support_reply' | 'welcome' | 'admin_push';

const INVALID_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

/**
 * Push delivery through Firebase Cloud Messaging (firebase-admin, same service account as Firestore;
 * no extra secret). The Android app registers its native FCM token via POST /api/me/push-token.
 * Dead tokens are pruned automatically. Legacy Expo tokens are still delivered via Expo's service.
 */
export async function pushToUser(uid: string, title: string, body: string, data: Record<string, string> = {}, opts: { respectPrefs?: boolean } = {}) {
  const user = await db().collection(C.users).doc(uid).get();
  const prefs = user.get('notificationPrefs') ?? {};
  if (opts.respectPrefs !== false && prefs.push === false) return { sent: 0, failed: 0 };
  const fcm: string[] = (user.get('fcmTokens') ?? []).filter((t: unknown) => typeof t === 'string' && t.length > 20);
  const expo: string[] = (user.get('expoPushTokens') ?? []).filter((t: string) => /^ExponentPushToken\[/.test(t));
  let sent = 0; let failed = 0;
  if (fcm.length) {
    try {
      const r = await messaging().sendEachForMulticast({
        tokens: fcm.slice(0, 500),
        notification: { title: title.slice(0, 120), body: body.slice(0, 500) },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { channelId: data.channel || 'default', color: '#7c5cff', sound: 'default' } },
      });
      sent += r.successCount; failed += r.failureCount;
      const dead = r.responses.map((x, i) => (!x.success && INVALID_TOKEN.has(x.error?.code ?? '') ? fcm[i] : null)).filter(Boolean) as string[];
      if (dead.length) await user.ref.set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true });
    } catch (e) { logger.warn({ err: e }, 'fcm push failed'); }
  }
  if (expo.length) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(expo.map((to) => ({ to, title, body, data, sound: 'default', channelId: 'default' }))),
      });
      if (r.ok) sent += expo.length; else failed += expo.length;
    } catch { failed += expo.length; }
  }
  return { sent, failed };
}

/** In-app notification + push (automatic events: generation done/failed, payments, credits, plan expiry…). */
export async function notify(uid: string, type: NotificationType, title: string, body: string, data: Record<string, string> = {}) {
  await db().collection(C.notifications).add({ ownerId: uid, type, title, body, data, read: false, createdAt: Date.now() });
  try {
    await pushToUser(uid, title, body, { type, ...data, channel: type.startsWith('generation') ? 'jobs' : 'default' });
  } catch (e) {
    logger.warn({ err: e }, 'push delivery error');
  }
}

/** Cheap daily analytics counters (1 write per event, no scans). */
export async function track(metric: string, n = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const { FieldValue } = await import('../lib/firebase.js');
  await db().collection('analytics_daily').doc(day).set({ [metric]: FieldValue.increment(n), day }, { merge: true }).catch(() => undefined);
}

export async function adminAudit(actorUid: string, action: string, target: string, details: Record<string, unknown> = {}) {
  await db().collection(C.audit).add({ actorUid, action, target, details, at: Date.now() });
}
