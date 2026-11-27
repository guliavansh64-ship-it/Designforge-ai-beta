import { Router } from 'express';
import { z } from 'zod';
import type { Project } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { createVersion, getVersion, loadProject } from '../services/repo.js';
import { getEntitlements } from '../services/plans.js';
import { sanitizeSavedHtml } from '../services/sanitize.js';
import { auditHtml } from '../services/audit.js';
import { newId } from '../lib/crypto.js';
import { AppError, Errors } from '../lib/errors.js';
import { auth } from '../lib/firebase.js';
import { safeQuery } from '../lib/safeQuery.js';
import { assertProjectQuota } from '../services/plans.js';

export const projectsRouter = Router();

const device = z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']);

/** Paginated, owner-scoped listing. Search is a case-insensitive prefix on nameLower. */
projectsRouter.get('/projects', validate(z.object({
  q: z.string().max(80).optional(),
  kind: z.enum(['ui', 'website', 'logo', 'improve']).optional(),
  folder: z.string().max(60).optional(),
  archived: z.enum(['true', 'false']).optional(),
  sort: z.enum(['updated', 'created', 'name']).default('updated'),
  shared: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
}), 'query'), ah(async (req, res) => {
  const { q, kind, folder, archived, sort, limit, cursor, shared } = req.query as any;
  const uid = req.user!.uid;
  if (shared === 'true') {
    // Shared lists are small. `sharedWith.<uid>` is a dynamic field path that can't have a composite
    // index, so we query the `sharedUids` array (single-field index) and filter/sort in memory.
    const s = await db().collection(C.projects).where('sharedUids', 'array-contains', uid).limit(200).get();
    const ql = q ? String(q).toLowerCase() : '';
    const key = sort === 'name' ? 'nameLower' : sort === 'created' ? 'createdAt' : 'updatedAt';
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
      .filter((p) => !!p.archived === (archived === 'true') && (!kind || p.kind === kind) && (!folder || p.folder === folder) && (!ql || String(p.nameLower).startsWith(ql)))
      .sort((a, b) => (sort === 'name' ? String(a[key]).localeCompare(String(b[key])) : (b[key] ?? 0) - (a[key] ?? 0)));
    return res.json({ projects: list.slice(0, limit), nextCursor: null });
  }
  const where: [string, any, unknown][] = [['ownerId', '==', uid], ['archived', '==', archived === 'true']];
  if (kind) where.push(['kind', '==', kind]);
  if (folder) where.push(['folder', '==', folder]);
  let orderBy: [string, 'asc' | 'desc'];
  if (q) {
    const ql = q.toLowerCase();
    where.push(['nameLower', '>=', ql], ['nameLower', '<=', ql + '\uf8ff']);
    orderBy = ['nameLower', 'asc'];
  } else {
    orderBy = [sort === 'name' ? 'nameLower' : sort === 'created' ? 'createdAt' : 'updatedAt', sort === 'name' ? 'asc' : 'desc'];
  }
  const found = await safeQuery(db().collection(C.projects), { where, orderBy, limit: limit + 1, startAfterId: cursor });
  const snap = { docs: found, size: found.length };
  // Mark projects whose design is still being generated, so the list shows "Generating…" and the
  // project screen can re-attach to the running job after the user navigated away.
  const active = new Map<string, { id: string; status: string; progress: number }>();
  try {
    const js = await db().collection(C.jobs).where('ownerId', '==', uid).where('status', 'in', ['queued', 'running']).limit(20).get();
    js.docs.forEach((d) => { const j = d.data(); if (j.projectId) active.set(j.projectId, { id: d.id, status: j.status, progress: j.progress ?? 0 }); });
  } catch { /* index missing etc. — the list still works without the badge */ }
  const docs = snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data(), activeJob: active.get(d.id) ?? null }));
  res.json({ projects: docs, nextCursor: snap.size > limit ? docs[docs.length - 1].id : null });
}));

projectsRouter.post('/projects', validate(z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['ui', 'website', 'logo', 'improve']),
  deviceType: device.default('DESKTOP'),
  description: z.string().max(500).optional(),
  folder: z.string().max(60).optional(),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const { plan } = await getEntitlements(uid);
  await assertProjectQuota(uid, plan);
  if (req.body.kind === 'website' && !plan.features.includes('website_studio')) throw Errors.feature('website studio');
  if (req.body.kind === 'logo' && !plan.features.includes('logo_studio')) throw Errors.feature('logo studio');
  const id = newId('p_');
  const now = Date.now();
  const project: Project & { nameLower: string } = {
    id, ownerId: uid, name: req.body.name, nameLower: req.body.name.toLowerCase(), kind: req.body.kind,
    description: req.body.description ?? '', folder: req.body.folder ?? '', archived: false, deviceType: req.body.deviceType,
    pages: req.body.kind === 'logo' ? [] : [{ id: newId('pg_'), name: req.body.kind === 'website' ? 'Home' : 'Screen 1' }],
    sharedWith: {}, sharedUids: [], createdAt: now, updatedAt: now,
  };
  await db().collection(C.projects).doc(id).set(project);
  res.status(201).json({ project });
}));

projectsRouter.get('/projects/:id', ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'viewer');
  res.json({ project: p });
}));

projectsRouter.patch('/projects/:id', validate(z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  folder: z.string().max(60).optional(),
  archived: z.boolean().optional(),
  deviceType: device.optional(),
})), ah(async (req, res) => {
  await loadProject(req.params.id, req.user!.uid, 'editor');
  const patch: Record<string, unknown> = { ...req.body, updatedAt: Date.now() };
  if (req.body.name) patch.nameLower = req.body.name.toLowerCase();
  await db().collection(C.projects).doc(req.params.id).update(patch);
  res.json({ ok: true });
}));

projectsRouter.delete('/projects/:id', ah(async (req, res) => {
  await loadProject(req.params.id, req.user!.uid, 'owner');
  const versions = await db().collection(C.versions).where('projectId', '==', req.params.id).where('ownerId', '==', req.user!.uid).get();
  for (let i = 0; i < versions.docs.length; i += 400) {
    const b = db().batch();
    versions.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await db().collection(C.projects).doc(req.params.id).delete();
  res.json({ ok: true });
}));

projectsRouter.post('/projects/:id/duplicate', ah(async (req, res) => {
  const uid = req.user!.uid;
  const src = await loadProject(req.params.id, uid, 'viewer');
  const id = newId('p_');
  const now = Date.now();
  const pages = [];
  const { access, ...rest } = src;
  await db().collection(C.projects).doc(id).set({ ...rest, id, ownerId: uid, name: `${src.name} (copy)`, nameLower: `${src.name} (copy)`.toLowerCase(), pages: [], sharedWith: {}, sharedUids: [], stitchProjectId: null, archived: false, createdAt: now, updatedAt: now });
  for (const pg of src.pages) {
    const newPg = { id: newId('pg_'), name: pg.name };
    pages.push(newPg);
    await db().collection(C.projects).doc(id).update({ pages });
    if (pg.currentVersionId) {
      const v = await getVersion(pg.currentVersionId, uid);
      await createVersion({ projectId: id, ownerId: uid, pageId: newPg.id, source: 'manual_edit', prompt: `Duplicated from ${src.name}`, html: v.html, imageUrl: v.imageUrl, audit: v.audit });
    }
  }
  res.status(201).json({ id });
}));

// ── Pages
projectsRouter.post('/projects/:id/pages', validate(z.object({ name: z.string().trim().min(1).max(60) })), ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'editor');
  const page = { id: newId('pg_'), name: req.body.name };
  await db().collection(C.projects).doc(p.id).update({ pages: [...p.pages, page], updatedAt: Date.now() });
  res.status(201).json({ page });
}));

projectsRouter.patch('/projects/:id/pages/:pageId', validate(z.object({ name: z.string().trim().min(1).max(60) })), ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'editor');
  await db().collection(C.projects).doc(p.id).update({ pages: p.pages.map((pg) => (pg.id === req.params.pageId ? { ...pg, name: req.body.name } : pg)), updatedAt: Date.now() });
  res.json({ ok: true });
}));

projectsRouter.delete('/projects/:id/pages/:pageId', ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'editor');
  if (p.pages.length <= 1 && p.kind !== 'logo') throw Errors.validation('A project needs at least one page');
  await db().collection(C.projects).doc(p.id).update({ pages: p.pages.filter((pg) => pg.id !== req.params.pageId), updatedAt: Date.now() });
  res.json({ ok: true });
}));

// ── Versions
projectsRouter.get('/projects/:id/versions', validate(z.object({ pageId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), 'query'), ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'viewer');
  const where: [string, any, unknown][] = [['projectId', '==', p.id], ['ownerId', '==', p.ownerId]];
  if (req.query.pageId) where.push(['pageId', '==', req.query.pageId]);
  const snap = { docs: await safeQuery(db().collection(C.versions), { where, orderBy: ['createdAt', 'desc'], limit: Number(req.query.limit), fallbackCap: 500 }) };
  // Omit heavy html in list view.
  res.json({ versions: snap.docs.map((d) => { const { html, ...v } = d.data(); return { ...v, hasHtml: !!html || !!v.htmlStorageUrl }; }) });
}));

projectsRouter.get('/versions/:vid', ah(async (req, res) => res.json({ version: await getVersion(req.params.vid, req.user!.uid) })));

/** Restore an old version / promote a variant: creates a NEW head version (history is append-only). */
projectsRouter.post('/versions/:vid/restore', ah(async (req, res) => {
  const v = await getVersion(req.params.vid, req.user!.uid);
  await loadProject(v.projectId, req.user!.uid, 'editor');
  const nv = await createVersion({ projectId: v.projectId, ownerId: v.ownerId, pageId: v.pageId, parentVersionId: v.id, source: v.source === 'stitch_variant' ? 'stitch_variant' : 'manual_edit', prompt: `Restored ${v.id}`, html: v.html, imageUrl: v.imageUrl, stitchScreenId: v.stitchScreenId, audit: v.audit });
  res.json({ version: nv });
}));

/** Manual editor save (properties panel / text edits). Autosave from clients is debounced. */
projectsRouter.post('/projects/:id/pages/:pageId/save', validate(z.object({ html: z.string().min(20).max(2_000_000), parentVersionId: z.string().optional(), note: z.string().max(200).optional() })), ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'editor');
  const page = p.pages.find((pg) => pg.id === req.params.pageId);
  if (!page) throw Errors.notFound('Page');
  const prev = page.currentVersionId ? await db().collection(C.versions).doc(page.currentVersionId).get() : undefined;
  const { html, report } = sanitizeSavedHtml(req.body.html);
  const v = await createVersion({
    projectId: p.id, ownerId: p.ownerId, pageId: page.id, parentVersionId: req.body.parentVersionId ?? page.currentVersionId,
    source: 'manual_edit', prompt: req.body.note ?? 'Manual edit', html,
    stitchScreenId: prev?.get('stitchScreenId'), imageUrl: prev?.get('imageUrl'),
    audit: auditHtml(html, p.kind, p.deviceType),
  });
  res.json({ version: v, sanitized: report.removed });
}));

projectsRouter.post('/versions/:vid/audit', ah(async (req, res) => {
  const v = await getVersion(req.params.vid, req.user!.uid);
  const p = await loadProject(v.projectId, req.user!.uid, 'viewer');
  const audit = auditHtml(v.html, p.kind, p.deviceType);
  if (p.access !== 'viewer') await db().collection(C.versions).doc(v.id).update({ audit });
  res.json({ audit });
}));

// ── Sharing (owner only; Premium feature)
projectsRouter.post('/projects/:id/share', validate(z.object({ email: z.string().email(), role: z.enum(['viewer', 'editor', 'none']) })), ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'owner');
  const { plan } = await getEntitlements(req.user!.uid);
  if (!plan.features.includes('project_sharing')) throw Errors.feature('project sharing');
  let target;
  try { target = await auth().getUserByEmail(req.body.email); } catch { throw Errors.notFound('Designo user with that email'); }
  if (target.uid === req.user!.uid) throw Errors.validation('You already own this project');
  const sharedWith = { ...(p.sharedWith ?? {}) };
  if (req.body.role === 'none') delete sharedWith[target.uid]; else sharedWith[target.uid] = req.body.role;
  await db().collection(C.projects).doc(p.id).update({ sharedWith, sharedUids: Object.keys(sharedWith), updatedAt: Date.now() });
  res.json({ ok: true, sharedWith });
}));

projectsRouter.get('/folders', ah(async (req, res) => {
  const snap = await db().collection(C.projects).where('ownerId', '==', req.user!.uid).select('folder').limit(500).get();
  res.json({ folders: [...new Set(snap.docs.map((d) => d.get('folder')).filter(Boolean))].sort() });
}));
