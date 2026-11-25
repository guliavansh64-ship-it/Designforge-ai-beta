import { Router } from 'express';
import { z } from 'zod';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { generationLimiter } from '../middleware/rateLimit.js';
import { loadProject } from '../services/repo.js';
import { getEntitlements } from '../services/plans.js';
import { listConnectionStatus } from '../services/connections.js';
import { cancelJob, enqueue } from '../services/jobs.js';
import { AppError, Errors } from '../lib/errors.js';
import { getSystemSettings } from '../services/settings.js';

/**
 * AI generation endpoints. All return 202 + a job; clients poll GET /jobs/:id.
 * AI operations are OWNER-only: each call uses the requester's own Stitch/Gemini
 * credentials, and the linked Stitch project lives in the owner's Google account.
 * (Shared editors can view, comment and make manual edits — never use the owner's key.)
 */
export const generateRouter = Router();

const device = z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']);
const model = z.enum(['GEMINI_3_FLASH', 'GEMINI_3_1_PRO']).default('GEMINI_3_FLASH');
const idem = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'idempotencyKey must be 8–64 url-safe chars');

async function preflight(uid: string, provider: 'stitch' | 'gemini', m?: string) {
  const conns = await listConnectionStatus(uid);
  const c = conns.find((x) => x.provider === provider)!;
  if (!c.connected) {
    if (c.status === 'invalid') throw new AppError(412, provider === 'stitch' ? 'STITCH_AUTH_FAILED' : 'GEMINI_ERROR', `Your ${provider === 'stitch' ? 'Stitch' : 'Gemini'} key is no longer valid. Reconnect it in Integrations.`, 'open_integrations');
    throw provider === 'stitch' ? Errors.stitchNotConnected() : Errors.geminiNotConnected();
  }
  const ent = await getEntitlements(uid);
  if (m === 'GEMINI_3_1_PRO' && !ent.plan.features.includes('pro_model')) throw Errors.feature('Pro model (Gemini 3.1 Pro)');
  const settings = await getSystemSettings();
  return { ...ent, settings, priority: ent.plan.features.includes('priority_queue') };
}

generateRouter.post('/projects/:id/generate', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(5).max(4000), deviceType: device.optional(), model,
  pageId: z.string().optional(), newPageName: z.string().max(60).optional(),
  category: z.string().max(40).optional(), style: z.string().max(200).optional(), idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch', req.body.model);
  if (project.kind === 'website' && !pf.plan.features.includes('website_studio')) throw Errors.feature('website studio');
  const deviceType = req.body.deviceType ?? project.deviceType;
  const job = await enqueue({
    ownerId: uid, projectId: project.id, type: 'generate', prompt: req.body.prompt,
    payload: { ...req.body, deviceType }, op: req.body.model === 'GEMINI_3_1_PRO' ? 'generate_pro' : 'generate_flash',
    idempotencyKey: req.body.idempotencyKey, priority: pf.priority, deviceType, model: req.body.model,
  });
  res.status(202).json({ job });
}));

generateRouter.post('/projects/:id/edit', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(3).max(4000), pageId: z.string(), section: z.string().max(80).optional(),
  deviceType: device.optional(), model, idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch', req.body.model);
  const deviceType = req.body.deviceType ?? project.deviceType;
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'edit', prompt: req.body.prompt, payload: { ...req.body, deviceType }, op: 'edit', idempotencyKey: req.body.idempotencyKey, priority: pf.priority, deviceType, model: req.body.model });
  res.status(202).json({ job });
}));

generateRouter.post('/projects/:id/variants', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(3).max(2000), pageId: z.string(), count: z.number().int().min(1).max(5).default(3),
  creativeRange: z.enum(['REFINE', 'EXPLORE', 'REIMAGINE']).default('EXPLORE'), deviceType: device.optional(), model, idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch', req.body.model);
  if (!pf.plan.features.includes('variants')) throw Errors.feature('design variations');
  const deviceType = req.body.deviceType ?? project.deviceType;
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'variants', prompt: req.body.prompt, payload: { ...req.body, deviceType }, op: 'variants', idempotencyKey: req.body.idempotencyKey, priority: pf.priority, deviceType, model: req.body.model });
  res.status(202).json({ job });
}));

generateRouter.post('/projects/:id/improve', generationLimiter, validate(z.object({
  pageId: z.string(), instructions: z.string().max(2000).optional(),
  autoIterate: z.boolean().default(false), maxIterations: z.number().int().min(1).max(5).default(1),
  targetScore: z.number().int().min(50).max(100).default(90), deviceType: device.optional(), model, idempotencyKey: idem,
  importAssetBase64: z.string().max(7_000_000).optional(), importExt: z.enum(['.html', '.png', '.jpg', '.jpeg', '.webp']).optional(),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch', req.body.model);
  if ((req.body.autoIterate || req.body.maxIterations > 1) && !pf.plan.features.includes('auto_improve')) throw Errors.feature('auto-improve mode');
  const maxIterations = Math.min(req.body.maxIterations, pf.plan.maxImproveIterations);
  const deviceType = req.body.deviceType ?? project.deviceType;
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'improve', prompt: req.body.instructions ?? 'Improve design', payload: { ...req.body, maxIterations, deviceType }, op: 'improve_iteration', idempotencyKey: req.body.idempotencyKey, priority: pf.priority, deviceType, model: req.body.model });
  res.status(202).json({ job, maxIterations });
}));

generateRouter.post('/projects/:id/logos', generationLimiter, validate(z.object({
  brandName: z.string().trim().min(1).max(40), industry: z.string().trim().min(2).max(60),
  styles: z.array(z.enum(['Minimalist', 'Modern', 'Wordmark', 'Icon', 'Emblem', 'Abstract'])).min(1).max(6),
  colorHints: z.string().max(120).optional(), tagline: z.string().max(140).optional(),
  count: z.number().int().min(1).max(4).default(2), idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  if (project.kind !== 'logo') throw Errors.validation('Logo generation runs inside a Logo project');
  const pf = await preflight(uid, 'gemini');
  if (!pf.plan.features.includes('logo_studio')) throw Errors.feature('logo studio');
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'logo', prompt: `${req.body.brandName} — ${req.body.styles.join(', ')}`, payload: req.body, op: 'logo_batch', multiplier: Math.ceil(req.body.count / 2), idempotencyKey: req.body.idempotencyKey, priority: pf.priority });
  res.status(202).json({ job });
}));

generateRouter.get('/jobs/:jobId', ah(async (req, res) => {
  const s = await db().collection(C.jobs).doc(req.params.jobId).get();
  if (!s.exists || s.get('ownerId') !== req.user!.uid) throw Errors.notFound('Job');
  const { payload, ...job } = s.data()!;
  res.json({ job });
}));

generateRouter.get('/projects/:id/jobs', ah(async (req, res) => {
  await loadProject(req.params.id, req.user!.uid, 'viewer');
  const s = await db().collection(C.jobs).where('ownerId', '==', req.user!.uid).where('projectId', '==', req.params.id).orderBy('createdAt', 'desc').limit(20).get();
  res.json({ jobs: s.docs.map((d) => { const { payload, ...j } = d.data(); return j; }) });
}));

generateRouter.post('/jobs/:jobId/cancel', ah(async (req, res) => {
  const job = await cancelJob(req.params.jobId, req.user!.uid);
  const { payload, ...rest } = (job ?? {}) as any;
  res.json({ job: rest });
}));
