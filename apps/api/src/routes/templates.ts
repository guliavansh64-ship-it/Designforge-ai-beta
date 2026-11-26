import { Router } from 'express';
import { z } from 'zod';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { createVersion } from '../services/repo.js';
import { getEntitlements } from '../services/plans.js';
import { auditHtml } from '../services/audit.js';
import { newId } from '../lib/crypto.js';
import { AppError, Errors } from '../lib/errors.js';
import { assertProjectQuota } from '../services/plans.js';

export const templatesPublicRouter = Router();

templatesPublicRouter.get('/templates', validate(z.object({ category: z.string().max(40).optional(), q: z.string().max(60).optional(), featured: z.enum(['true']).optional() }), 'query'), ah(async (req, res) => {
  let q: FirebaseFirestore.Query = db().collection(C.templates).where('published', '==', true);
  if (req.query.category) q = q.where('category', '==', req.query.category);
  if (req.query.featured) q = q.where('featured', '==', true);
  const s = await q.limit(100).get();
  let list = s.docs.map((d) => { const { html, ...t } = d.data(); return { id: d.id, ...t }; });
  if (req.query.q) { const ql = String(req.query.q).toLowerCase(); list = list.filter((t: any) => `${t.name} ${t.description} ${(t.tags ?? []).join(' ')}`.toLowerCase().includes(ql)); }
  res.json({ templates: list });
}));
templatesPublicRouter.get('/templates/:id', ah(async (req, res) => {
  const s = await db().collection(C.templates).doc(req.params.id).get();
  if (!s.exists || !s.get('published')) throw Errors.notFound('Template');
  res.json({ template: { id: s.id, ...s.data() } });
}));

export const templatesRouter = Router();

templatesRouter.post('/templates/:id/favorite', validate(z.object({ favorite: z.boolean() })), ah(async (req, res) => {
  const { FieldValue } = await import('../lib/firebase.js');
  await db().collection(C.prefs).doc(req.user!.uid).set({ ownerId: req.user!.uid, favoriteTemplates: req.body.favorite ? FieldValue.arrayUnion(req.params.id) : FieldValue.arrayRemove(req.params.id) }, { merge: true });
  res.json({ ok: true });
}));

/** Use template → new private project seeded with the template HTML as version 1 (then customise with AI). */
templatesRouter.post('/templates/:id/use', validate(z.object({ name: z.string().trim().min(1).max(80).optional() })), ah(async (req, res) => {
  const uid = req.user!.uid;
  const t = await db().collection(C.templates).doc(req.params.id).get();
  if (!t.exists || !t.get('published')) throw Errors.notFound('Template');
  const { plan } = await getEntitlements(uid);
  await assertProjectQuota(uid, plan);
  const td = t.data()!;
  const id = newId('p_'); const pageId = newId('pg_'); const now = Date.now();
  const name = req.body.name ?? `${td.name}`;
  await db().collection(C.projects).doc(id).set({ id, ownerId: uid, name, nameLower: name.toLowerCase(), kind: td.kind ?? 'website', description: `From template: ${td.name}`, folder: '', archived: false, deviceType: td.deviceType ?? 'DESKTOP', pages: [{ id: pageId, name: 'Home' }], sharedWith: {}, sharedUids: [], templateId: t.id, createdAt: now, updatedAt: now });
  await createVersion({ projectId: id, ownerId: uid, pageId, source: 'template', prompt: `Template ${td.name}`, html: td.html, imageUrl: td.thumbnailUrl, audit: auditHtml(td.html, td.kind ?? 'website', td.deviceType ?? 'DESKTOP') });
  await t.ref.update({ uses: (td.uses ?? 0) + 1 });
  res.status(201).json({ projectId: id });
}));
