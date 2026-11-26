import { Router } from 'express';
import { z } from 'zod';
import { auth, db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { invalidateAuthCache, requireAdmin } from '../middleware/auth.js';
import { adminAudit, notify } from '../services/notify.js';
import { invalidatePlans, listPlans, getEntitlements } from '../services/plans.js';
import { invalidateSettingsCache, getSystemSettings } from '../services/settings.js';
import { listConnectionStatus } from '../services/connections.js';
import * as credits from '../services/credits.js';
import { refundPayment } from '../services/billing.js';
import { Errors } from '../lib/errors.js';
import { auditHtml } from '../services/audit.js';
import { safeQuery } from '../lib/safeQuery.js';

/**
 * Admin API. Every route: requireAuth (Firebase) → requireAdmin (custom claim + active admin_users doc).
 * Admins can NEVER read user credentials: connection endpoints return status only, and the
 * encrypted blobs are excluded from every query projection here.
 * Every mutation writes to admin_audit_logs.
 */
export const adminRouter = Router();
adminRouter.use(requireAdmin());

const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;

adminRouter.get('/stats', ah(async (_req, res) => {
  const now = Date.now(); const d30 = now - 30 * 86400_000; const d7 = now - 7 * 86400_000;
  const [users, active7, new30, paid, projects, gens, failed] = await Promise.all([
    count(db().collection(C.users)), count(db().collection(C.users).where('lastSeenAt', '>=', d7)),
    count(db().collection(C.users).where('createdAt', '>=', d30)),
    count(db().collection(C.subscriptions).where('status', '==', 'active').where('planId', 'in', ['pro', 'premium', 'lifetime'])),
    count(db().collection(C.projects)), count(db().collection(C.generations).where('status', '==', 'succeeded')),
    count(db().collection(C.generations).where('status', '==', 'failed')),
  ]);
  const days = await db().collection('analytics_daily').orderBy('day', 'desc').limit(365).get();
  const daily = days.docs.map((d) => d.data()).reverse();
  const month = new Date().toISOString().slice(0, 7); const year = new Date().getFullYear().toString();
  const sum = (filter: (d: any) => boolean, k: string) => daily.filter(filter).reduce((s, d) => s + (d[k] ?? 0), 0);
  res.json({
    users, activeUsers7d: active7, newRegistrations30d: new30, paidSubscribers: paid, projects,
    generationsSucceeded: gens, generationsFailed: failed,
    successRate: gens + failed ? Math.round((gens / (gens + failed)) * 100) : null,
    revenueMonthInr: sum((d) => d.day.startsWith(month), 'revenue_paise') / 100,
    revenueYearInr: sum((d) => d.day.startsWith(year), 'revenue_paise') / 100,
    daily: daily.slice(-90),
  });
}));

adminRouter.get('/users', validate(z.object({ q: z.string().max(80).optional(), status: z.enum(['active', 'suspended']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional() }), 'query'), ah(async (req, res) => {
  let q: FirebaseFirestore.Query = db().collection(C.users);
  const { q: search, status, limit, cursor } = req.query as any;
  if (status) q = q.where('status', '==', status);
  if (search) q = q.where('email', '>=', search.toLowerCase()).where('email', '<=', search.toLowerCase() + '\uf8ff').orderBy('email');
  else q = q.orderBy('createdAt', 'desc');
  if (cursor) { const c = await db().collection(C.users).doc(cursor).get(); if (c.exists) q = q.startAfter(c); }
  const s = await q.limit(limit + 1).get();
  const users = s.docs.slice(0, limit).map((d) => ({ id: d.id, email: d.get('email'), displayName: d.get('displayName'), photoURL: d.get('photoURL'), status: d.get('status'), createdAt: d.get('createdAt'), lastSeenAt: d.get('lastSeenAt') }));
  res.json({ users, nextCursor: s.size > limit ? users[users.length - 1].id : null });
}));

adminRouter.get('/users/:uid', ah(async (req, res) => {
  const uid = req.params.uid;
  const u = await db().collection(C.users).doc(uid).get();
  if (!u.exists) throw Errors.notFound('User');
  const [ent, balance, connections, txns, projects, pays] = await Promise.all([
    getEntitlements(uid), credits.getBalance(uid), listConnectionStatus(uid),
    safeQuery(db().collection(C.creditTxns), { where: [['ownerId', '==', uid]], orderBy: ['createdAt', 'desc'], limit: 30 }).then((docs) => ({ docs })),
    count(db().collection(C.projects).where('ownerId', '==', uid)),
    safeQuery(db().collection(C.payments), { where: [['ownerId', '==', uid]], orderBy: ['createdAt', 'desc'], limit: 20 }).then((docs) => ({ docs })),
  ]);
  const { expoPushTokens, ...profile } = u.data()!;
  res.json({
    user: { id: uid, ...profile }, plan: ent.plan, subscription: ent.sub, credits: balance,
    connections, // status + last-4 hint only — never the key
    projectCount: projects,
    transactions: txns.docs.map((d) => ({ id: d.id, ...d.data() })),
    payments: pays.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
}));

adminRouter.post('/users/:uid/status', requireAdmin('admin', 'support'), validate(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(300) })), ah(async (req, res) => {
  const uid = req.params.uid;
  await db().collection(C.users).doc(uid).update({ status: req.body.status, statusReason: req.body.reason, statusChangedAt: Date.now() });
  await auth().updateUser(uid, { disabled: req.body.status === 'suspended' });
  if (req.body.status === 'suspended') await auth().revokeRefreshTokens(uid);
  invalidateAuthCache(uid);
  await adminAudit(req.user!.uid, `user.${req.body.status}`, uid, { reason: req.body.reason });
  res.json({ ok: true });
}));

/** Retention policy: projects/credentials deleted immediately; payments anonymised & kept 8 years (Indian tax law). */
adminRouter.delete('/users/:uid', requireAdmin('admin'), validate(z.object({ reason: z.string().min(5).max(300) })), ah(async (req, res) => {
  const uid = req.params.uid;
  for (const col of [C.projects, C.versions, C.jobs, C.generations, C.notifications, C.connections, C.chat, C.assets, C.tickets]) {
    while (true) {
      const s = await db().collection(col).where('ownerId', '==', uid).limit(300).get();
      if (s.empty) break;
      const b = db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
    }
  }
  const pays = await db().collection(C.payments).where('ownerId', '==', uid).get();
  const b = db().batch();
  pays.docs.forEach((d) => b.update(d.ref, { ownerId: `deleted_${uid.slice(0, 6)}`, anonymisedAt: Date.now() }));
  [C.users, C.prefs, C.wallets, C.subscriptions].forEach((c) => b.delete(db().collection(c).doc(uid)));
  await b.commit();
  await auth().deleteUser(uid).catch(() => undefined);
  await adminAudit(req.user!.uid, 'user.delete', uid, { reason: req.body.reason });
  res.json({ ok: true });
}));

adminRouter.post('/users/:uid/credits', requireAdmin('admin', 'finance'), validate(z.object({ amount: z.number().int().min(-100000).max(100000).refine((n) => n !== 0), reason: z.string().min(3).max(300), ref: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/) })), ah(async (req, res) => {
  const r = await credits.grant(req.params.uid, req.body.amount, `Admin: ${req.body.reason}`, `admin_${req.body.ref}`, { by: req.user!.uid });
  await adminAudit(req.user!.uid, 'credits.adjust', req.params.uid, req.body);
  if (req.body.amount > 0) await notify(req.params.uid, 'announcement', 'Credits added', `${req.body.amount} credits were added to your account.`);
  res.json(r);
}));

adminRouter.post('/users/:uid/subscription', requireAdmin('admin', 'finance'), validate(z.object({ planId: z.enum(['free', 'pro', 'premium', 'lifetime']), days: z.number().int().min(0).max(3650), reason: z.string().min(3).max(300) })), ah(async (req, res) => {
  const now = Date.now();
  await db().collection(C.subscriptions).doc(req.params.uid).set({ ownerId: req.params.uid, planId: req.body.planId, cycle: req.body.planId === 'lifetime' ? 'one_time' : 'monthly', status: 'active', currentPeriodStart: now, currentPeriodEnd: req.body.days ? now + req.body.days * 86400_000 : null, manual: true, updatedAt: now }, { merge: true });
  await adminAudit(req.user!.uid, 'subscription.set', req.params.uid, req.body);
  res.json({ ok: true });
}));

// ── Plans
adminRouter.get('/plans', ah(async (_req, res) => res.json({ plans: await listPlans(true) })));
adminRouter.put('/plans/:id', requireAdmin('admin'), validate(z.object({
  name: z.string().min(2).max(40), tagline: z.string().max(120), priceInrMonthly: z.number().min(0), priceInrAnnual: z.number().min(0),
  priceInrOneTime: z.number().min(0).optional(), monthlyCredits: z.number().int().min(0), annualCredits: z.number().int().min(0),
  oneTimeCredits: z.number().int().min(0).optional(), maxProjects: z.number().int().min(1), maxImproveIterations: z.number().int().min(1).max(5),
  features: z.array(z.string()), active: z.boolean(),
  razorpayPlanIds: z.object({ monthly: z.string().optional(), annual: z.string().optional() }).optional(),
})), ah(async (req, res) => {
  await db().collection(C.plans).doc(req.params.id).set({ ...req.body, id: req.params.id, updatedAt: Date.now() }, { merge: true });
  invalidatePlans();
  await adminAudit(req.user!.uid, 'plan.update', req.params.id, req.body);
  res.json({ ok: true });
}));

adminRouter.get('/subscriptions', validate(z.object({ status: z.string().optional(), planId: z.string().optional() }), 'query'), ah(async (req, res) => {
  const where: [string, '==', unknown][] = [];
  if (req.query.status) where.push(['status', '==', req.query.status]);
  if (req.query.planId) where.push(['planId', '==', req.query.planId]);
  const s = { docs: await safeQuery(db().collection(C.subscriptions), { where, orderBy: ['updatedAt', 'desc'], limit: 100 }) };
  res.json({ subscriptions: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

adminRouter.get('/payments', validate(z.object({ status: z.string().optional() }), 'query'), ah(async (req, res) => {
  const s = { docs: await safeQuery(db().collection(C.payments), { where: req.query.status ? [['status', '==', req.query.status]] : [], orderBy: ['createdAt', 'desc'], limit: 100 }) };
  res.json({ payments: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
adminRouter.post('/payments/:orderId/refund', requireAdmin('admin', 'finance'), validate(z.object({ amountPaise: z.number().int().min(100).optional(), reason: z.string().min(3).max(300) })), ah(async (req, res) => {
  const r = await refundPayment(req.params.orderId, req.body.amountPaise, req.body.reason);
  await adminAudit(req.user!.uid, 'payment.refund', req.params.orderId, req.body);
  res.json({ refund: r });
}));

// ── Coupons
adminRouter.get('/coupons', ah(async (_req, res) => {
  const s = await db().collection(C.coupons).orderBy('createdAt', 'desc').limit(200).get();
  res.json({ coupons: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
adminRouter.put('/coupons/:code', requireAdmin('admin', 'finance'), validate(z.object({
  type: z.enum(['percent', 'flat', 'credits']), value: z.number().positive(), maxRedemptions: z.number().int().min(0).default(0),
  expiresAt: z.number().int().optional(), appliesTo: z.array(z.string()).default([]), active: z.boolean().default(true), oncePerUser: z.boolean().default(true),
})), ah(async (req, res) => {
  const code = req.params.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const ref = db().collection(C.coupons).doc(code);
  const existing = await ref.get();
  await ref.set({ ...req.body, code, redeemed: existing.get('redeemed') ?? 0, createdAt: existing.get('createdAt') ?? Date.now(), updatedAt: Date.now() }, { merge: true });
  await adminAudit(req.user!.uid, 'coupon.upsert', code, req.body);
  res.json({ ok: true });
}));

// ── Templates & content moderation
adminRouter.get('/templates', ah(async (_req, res) => {
  const s = await db().collection(C.templates).limit(200).get();
  res.json({ templates: s.docs.map((d) => { const { html, ...t } = d.data(); return { id: d.id, ...t }; }) });
}));
adminRouter.put('/templates/:id', requireAdmin('admin'), validate(z.object({
  name: z.string().min(2).max(80), category: z.string().max(40), description: z.string().max(300), tags: z.array(z.string()).max(10).default([]),
  kind: z.enum(['ui', 'website']).default('website'), deviceType: z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']).default('DESKTOP'),
  html: z.string().min(50).max(800_000).optional(), thumbnailUrl: z.string().url().optional(), featured: z.boolean().default(false), published: z.boolean().default(true),
})), ah(async (req, res) => {
  const ref = db().collection(C.templates).doc(req.params.id);
  const patch: Record<string, unknown> = { ...req.body, updatedAt: Date.now() };
  if (req.body.html) patch.qualityScore = auditHtml(req.body.html, req.body.kind, req.body.deviceType).score;
  await ref.set(patch, { merge: true });
  await adminAudit(req.user!.uid, 'template.upsert', req.params.id, { name: req.body.name, featured: req.body.featured, published: req.body.published });
  res.json({ ok: true });
}));
adminRouter.delete('/templates/:id', requireAdmin('admin'), ah(async (req, res) => {
  await db().collection(C.templates).doc(req.params.id).delete();
  await adminAudit(req.user!.uid, 'template.delete', req.params.id);
  res.json({ ok: true });
}));

// ── Settings & announcements
adminRouter.get('/settings', ah(async (_req, res) => res.json({ settings: await getSystemSettings() })));
adminRouter.put('/settings', requireAdmin('admin'), validate(z.object({
  platformName: z.string().min(2).max(40).optional(), logoUrl: z.string().url().optional().or(z.literal('')), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  maintenanceMode: z.boolean().optional(), maintenanceMessage: z.string().max(300).optional(), supportEmail: z.string().email().optional(),
  supportUrl: z.string().url().optional().or(z.literal('')), termsUrl: z.string().url().optional().or(z.literal('')), privacyUrl: z.string().url().optional().or(z.literal('')),
  featureFlags: z.record(z.boolean()).optional(),
  limits: z.object({ maxPromptChars: z.number().int().min(200).max(10000), maxUploadBytes: z.number().int().min(100000).max(10_000_000), maxProjectsFree: z.number().int().min(1) }).partial().optional(),
})), ah(async (req, res) => {
  await db().collection(C.settings).doc('global').set({ ...req.body, updatedAt: Date.now() }, { merge: true });
  invalidateSettingsCache();
  await adminAudit(req.user!.uid, 'settings.update', 'global', req.body);
  res.json({ ok: true });
}));
adminRouter.get('/announcements', ah(async (_req, res) => {
  const s = await db().collection(C.announcements).orderBy('createdAt', 'desc').limit(50).get();
  res.json({ announcements: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
adminRouter.post('/announcements', requireAdmin('admin'), validate(z.object({ title: z.string().min(3).max(120), body: z.string().min(3).max(2000), level: z.enum(['info', 'success', 'warning']).default('info'), active: z.boolean().default(true) })), ah(async (req, res) => {
  const ref = await db().collection(C.announcements).add({ ...req.body, createdAt: Date.now(), by: req.user!.uid });
  await adminAudit(req.user!.uid, 'announcement.create', ref.id, req.body);
  res.status(201).json({ id: ref.id });
}));
adminRouter.patch('/announcements/:id', requireAdmin('admin'), validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  await db().collection(C.announcements).doc(req.params.id).update({ active: req.body.active });
  await adminAudit(req.user!.uid, 'announcement.toggle', req.params.id, req.body);
  res.json({ ok: true });
}));

// ── Support
adminRouter.get('/tickets', validate(z.object({ status: z.enum(['open', 'pending', 'resolved']).optional() }), 'query'), ah(async (req, res) => {
  const s = { docs: await safeQuery(db().collection(C.tickets), { where: req.query.status ? [['status', '==', req.query.status]] : [], orderBy: ['updatedAt', 'desc'], limit: 100 }) };
  res.json({ tickets: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
adminRouter.post('/tickets/:id/reply', requireAdmin('admin', 'support'), validate(z.object({ message: z.string().min(1).max(5000), status: z.enum(['open', 'pending', 'resolved']).default('pending') })), ah(async (req, res) => {
  const ref = db().collection(C.tickets).doc(req.params.id);
  const t = await ref.get();
  if (!t.exists) throw Errors.notFound('Ticket');
  const { FieldValue } = await import('../lib/firebase.js');
  await ref.update({ messages: FieldValue.arrayUnion({ from: 'support', text: req.body.message, at: Date.now(), by: req.user!.uid }), status: req.body.status, updatedAt: Date.now() });
  await notify(t.get('ownerId'), 'support_reply', 'Support replied', t.get('subject'), { ticketId: t.id });
  await adminAudit(req.user!.uid, 'ticket.reply', t.id, { status: req.body.status });
  res.json({ ok: true });
}));

// ── Errors & audit
adminRouter.get('/errors', ah(async (_req, res) => {
  const s = { docs: await safeQuery(db().collection(C.generations), { where: [['status', '==', 'failed']], orderBy: ['createdAt', 'desc'], limit: 100 }) };
  res.json({ errors: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
adminRouter.get('/audit-logs', ah(async (_req, res) => {
  const s = await db().collection(C.audit).orderBy('at', 'desc').limit(200).get();
  res.json({ logs: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
