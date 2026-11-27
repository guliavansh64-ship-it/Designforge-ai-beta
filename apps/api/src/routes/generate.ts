import { normalizeStitchModel } from '@designforge/shared';
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
import { safeQuery } from '../lib/safeQuery.js';
import { autoDevice, enhance } from '../services/promptEnhancer.js';
import * as credits from '../services/credits.js';

/**
 * AI generation endpoints. All return 202 + a job; clients poll GET /jobs/:id.
 * AI operations are OWNER-only: each call uses the requester's own Stitch/Gemini
 * credentials, and the linked Stitch project lives in the owner's Google account.
 * (Shared editors can view, comment and make manual edits — never use the owner's key.)
 */
export const generateRouter = Router();

/** Job as seen by clients: never the payload or the internal enhanced plan (only screen names). */
function publicJob(d: Record<string, any>) {
  const { payload: _p, plan, ...job } = d;
  return { ...job, ...(plan?.screens ? { screenNames: plan.screens.map((x: { name: string }) => x.name), appName: plan.appName } : {}) };
}

const device = z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']);
// Accepts current IDs and retired 0.3.x IDs from older app versions; always yields a valid Stitch model.
// The model is chosen automatically (best Stitch model, auto-fallback to the fast one in the runner).
const model = z.string().max(40).optional().transform(() => normalizeStitchModel(undefined));
const hex = z.string().regex(/^#[0-9A-Fa-f]{3,8}$/);
/** Older app builds may send a previewed plan; it is ignored — the server always plans (hidden from users). */
const planSchema = z.any();
const idem = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'idempotencyKey must be 8–64 url-safe chars');

async function preflight(uid: string, provider: 'stitch' | 'gemini', _m?: string) {
  const conns = await listConnectionStatus(uid);
  const c = conns.find((x) => x.provider === provider)!;
  if (!c.connected) {
    if (c.status === 'invalid') throw new AppError(412, provider === 'stitch' ? 'STITCH_AUTH_FAILED' : 'GEMINI_ERROR', `Your ${provider === 'stitch' ? 'Stitch' : 'Gemini'} key is no longer valid. Reconnect it in Integrations.`, 'open_integrations');
    throw provider === 'stitch' ? Errors.stitchNotConnected() : Errors.geminiNotConnected();
  }
  const ent = await getEntitlements(uid);
  const settings = await getSystemSettings();
  return { ...ent, settings, priority: ent.plan.features.includes('priority_queue') };
}

generateRouter.post('/projects/:id/generate', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(5).max(4000), deviceType: device.optional(), model,
  pageId: z.string().optional(), newPageName: z.string().max(60).optional(),
  category: z.string().max(40).optional(), style: z.string().max(200).optional(), idempotencyKey: idem,
  // Prompt enhancement + full-app generation. Absent → legacy single-screen behaviour (older app builds).
  enhance: z.boolean().optional(), mode: z.enum(['auto', 'single', 'app']).optional(),
  maxScreens: z.number().int().min(2).max(6).optional(), plan: planSchema.optional(), auto: z.boolean().optional(),
  pageNames: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch');
  if (project.kind === 'website' && !pf.plan.features.includes('website_studio')) throw Errors.feature('website studio');
  /*
   * Everything is chosen automatically (no pickers): one screen vs a full app, number of screens,
   * device, theme/style (by the planner) and the Stitch model (best model, auto-fallback to the fast
   * one). Client-sent style/model/mode from older app builds are ignored.
   */
  const hasDesigns = project.pages.some((x) => !!x.currentVersionId);
  const deviceType = hasDesigns || req.body.pageId || req.body.newPageName ? project.deviceType : autoDevice(req.body.prompt, project.kind, project.deviceType);
  if (!hasDesigns && deviceType !== project.deviceType) await db().collection(C.projects).doc(project.id).update({ deviceType }).catch(() => undefined);
  // A full app is charged per screen as each one starts; plan only as many screens as the user can afford.
  const per = credits.costOf('generate_flash', 1);
  const bal = await credits.getBalance(uid);
  if (bal < per) throw Errors.credits(per, bal);
  const maxScreens = Math.max(2, Math.min(5, Math.floor(bal / per)));
  const mode = hasDesigns || req.body.pageId || req.body.newPageName ? 'single' : bal < per * 2 ? 'single' : 'auto';
  const job = await enqueue({
    ownerId: uid, projectId: project.id, type: 'generate', prompt: req.body.prompt,
    payload: { prompt: req.body.prompt, pageId: req.body.pageId, newPageName: req.body.newPageName, deviceType, enhance: true, mode, maxScreens, model: 'GEMINI_3_8_FLASH' },
    op: 'generate_flash', idempotencyKey: req.body.idempotencyKey, priority: pf.priority, deviceType, model: 'GEMINI_3_8_FLASH',
  });
  res.status(202).json({ job });
}));

/**
 * Preview the enhanced prompt / app plan without generating anything (no credits).
 * Uses the caller's own Gemini key when connected, otherwise the built-in planner.
 */
generateRouter.post('/prompt/enhance', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(3).max(4000), kind: z.enum(['ui', 'website']).default('ui'), deviceType: device.default('MOBILE'),
  style: z.string().max(200).optional(), category: z.string().max(40).optional(),
  mode: z.enum(['auto', 'single', 'app']).default('auto'), maxScreens: z.number().int().min(2).max(6).default(5),
  pageNames: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})), ah(async (req, res) => {
  const b = req.body;
  const plan = await enhance(req.user!.uid, { prompt: b.prompt, kind: b.kind, device: b.deviceType, style: b.style, category: b.category, mode: b.mode, maxScreens: b.maxScreens, pageNames: b.pageNames });
  // The enhanced prompts are internal (sent only to Stitch): only the outline is returned.
  res.json({ plan: { appName: plan.appName, category: plan.category, isFullApp: plan.isFullApp, screens: plan.screens.map((x) => ({ name: x.name })) }, cost: credits.costOf('generate_flash', plan.screens.length) });
}));

generateRouter.post('/projects/:id/edit', generationLimiter, validate(z.object({
  prompt: z.string().trim().min(3).max(4000), pageId: z.string(), section: z.string().max(80).optional(),
  deviceType: device.optional(), model, idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const project = await loadProject(req.params.id, uid, 'owner');
  const pf = await preflight(uid, 'stitch', req.body.model);
  const deviceType = project.deviceType; // automatic: the project's device
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
  const deviceType = project.deviceType; // automatic: the project's device
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
  const deviceType = project.deviceType; // automatic: the project's device
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
  const pf = await preflight(uid, 'stitch'); // logos are designed by Google Stitch (user's own key)
  if (!pf.plan.features.includes('logo_studio')) throw Errors.feature('logo studio');
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'logo', prompt: `${req.body.brandName} — ${req.body.styles.join(', ')}`, payload: req.body, op: 'logo_batch', multiplier: Math.ceil(req.body.count / 2), idempotencyKey: req.body.idempotencyKey, priority: pf.priority });
  res.status(202).json({ job });
}));

/** "Change this logo": Stitch edits one logo concept (costs the same as a design edit). */
generateRouter.post('/versions/:vid/logo-edit', generationLimiter, validate(z.object({
  instruction: z.string().trim().min(3).max(400), idempotencyKey: idem,
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const vSnap = await db().collection(C.versions).doc(req.params.vid).get();
  if (!vSnap.exists || vSnap.get('source') !== 'logo') throw Errors.notFound('Logo concept');
  const project = await loadProject(vSnap.get('projectId'), uid, 'editor');
  const pf = await preflight(uid, 'stitch');
  if (!pf.plan.features.includes('logo_studio')) throw Errors.feature('logo studio');
  const job = await enqueue({ ownerId: uid, projectId: project.id, type: 'logo', prompt: `Change logo: ${req.body.instruction}`.slice(0, 200), payload: { editOf: vSnap.id, instruction: req.body.instruction }, op: 'edit', idempotencyKey: req.body.idempotencyKey, priority: pf.priority });
  res.status(202).json({ job });
}));

generateRouter.get('/jobs/:jobId', ah(async (req, res) => {
  const s = await db().collection(C.jobs).doc(req.params.jobId).get();
  if (!s.exists || s.get('ownerId') !== req.user!.uid) throw Errors.notFound('Job');
  res.json({ job: publicJob(s.data()!) });
}));

generateRouter.get('/projects/:id/jobs', ah(async (req, res) => {
  await loadProject(req.params.id, req.user!.uid, 'viewer');
  const s = { docs: await safeQuery(db().collection(C.jobs), { where: [['ownerId', '==', req.user!.uid], ['projectId', '==', req.params.id]], orderBy: ['createdAt', 'desc'], limit: 20 }) };
  res.json({ jobs: s.docs.map((d) => publicJob(d.data())) });
}));

generateRouter.post('/jobs/:jobId/cancel', ah(async (req, res) => {
  const job = await cancelJob(req.params.jobId, req.user!.uid);
  res.json({ job: publicJob((job ?? {}) as any) });
}));
