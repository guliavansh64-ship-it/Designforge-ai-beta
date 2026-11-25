import { Router } from 'express';
import { z } from 'zod';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { Errors } from '../lib/errors.js';

export const supportPublicRouter = Router();
supportPublicRouter.get('/announcements', ah(async (_req, res) => {
  const s = await db().collection(C.announcements).where('active', '==', true).orderBy('createdAt', 'desc').limit(10).get();
  res.json({ announcements: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
supportPublicRouter.get('/status', ah(async (_req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const a = (await db().collection('analytics_daily').doc(day).get()).data() ?? {};
  const ok = Object.entries(a).filter(([k]) => k.startsWith('gen_success')).reduce((s, [, v]) => s + Number(v), 0);
  const bad = Object.entries(a).filter(([k]) => k.startsWith('gen_failed')).reduce((s, [, v]) => s + Number(v), 0);
  const { getSystemSettings } = await import('../services/settings.js');
  const st = await getSystemSettings();
  res.json({ api: 'operational', maintenance: st.maintenanceMode, generationSuccessRateToday: ok + bad ? Math.round((ok / (ok + bad)) * 100) : null, stitchEndpoint: 'https://stitch.googleapis.com/mcp' });
}));

export const supportRouter = Router();

supportRouter.get('/tickets', ah(async (req, res) => {
  const s = await db().collection(C.tickets).where('ownerId', '==', req.user!.uid).orderBy('updatedAt', 'desc').limit(50).get();
  res.json({ tickets: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));
supportRouter.post('/tickets', validate(z.object({
  subject: z.string().trim().min(3).max(120), type: z.enum(['question', 'bug', 'feature', 'billing', 'account']),
  message: z.string().trim().min(10).max(5000), projectId: z.string().optional(),
})), ah(async (req, res) => {
  const now = Date.now();
  const ref = await db().collection(C.tickets).add({ ownerId: req.user!.uid, email: req.user!.email ?? null, subject: req.body.subject, type: req.body.type, projectId: req.body.projectId ?? null, status: 'open', messages: [{ from: 'user', text: req.body.message, at: now }], createdAt: now, updatedAt: now });
  res.status(201).json({ id: ref.id });
}));
supportRouter.post('/tickets/:id/reply', validate(z.object({ message: z.string().trim().min(1).max(5000) })), ah(async (req, res) => {
  const ref = db().collection(C.tickets).doc(req.params.id);
  const s = await ref.get();
  if (!s.exists || s.get('ownerId') !== req.user!.uid) throw Errors.notFound('Ticket');
  const { FieldValue } = await import('../lib/firebase.js');
  await ref.update({ messages: FieldValue.arrayUnion({ from: 'user', text: req.body.message, at: Date.now() }), status: 'open', updatedAt: Date.now() });
  res.json({ ok: true });
}));

supportRouter.get('/notifications', ah(async (req, res) => {
  const s = await db().collection(C.notifications).where('ownerId', '==', req.user!.uid).orderBy('createdAt', 'desc').limit(50).get();
  res.json({ notifications: s.docs.map((d) => ({ id: d.id, ...d.data() })), unread: s.docs.filter((d) => !d.get('read')).length });
}));
supportRouter.post('/notifications/read', validate(z.object({ ids: z.array(z.string()).max(100).optional() })), ah(async (req, res) => {
  const uid = req.user!.uid;
  const snap = req.body.ids?.length
    ? await Promise.all(req.body.ids.map((id: string) => db().collection(C.notifications).doc(id).get()))
    : (await db().collection(C.notifications).where('ownerId', '==', uid).where('read', '==', false).limit(200).get()).docs;
  const b = db().batch();
  snap.forEach((d: any) => { if (d.exists && d.get('ownerId') === uid) b.update(d.ref, { read: true }); });
  await b.commit();
  res.json({ ok: true });
}));
