import type { CreditOperation, DeviceType, GenerationJob, JobType, Project, ProjectKind, StitchModel } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { env } from '../config.js';
import { stitchEngine } from './stitch.js';
import { auditHtml, buildImprovementPlan, compareAudits, enrichPrompt } from './audit.js';
import { createVersion, getVersion, loadProject } from './repo.js';
import { persistRemoteImage } from './blobs.js';
import * as credits from './credits.js';
import { notify, track } from './notify.js';
import { runLogoJob, type LogoJobInput } from './logos.js';

/**
 * In-process job queue (free-tier friendly; single API instance).
 * - Job state is persisted in Firestore `generation_jobs` so clients poll and survive restarts.
 * - Priority lane for plans with `priority_queue`.
 * - Every job: credits reserved BEFORE enqueue → committed on success → refunded on failure/cancel.
 * - Cancellation is cooperative: checked between stages. An in-flight Stitch call cannot be
 *   aborted (SDK has no abort signal), but its result is discarded and credits refunded.
 * Scale-out path: replace `enqueue` with Cloud Tasks / BullMQ — runners are pure functions.
 */

export interface GeneratePayload { prompt: string; deviceType: DeviceType; model: StitchModel; pageId?: string; newPageName?: string; category?: string; style?: string }
export interface EditPayload { prompt: string; pageId: string; deviceType: DeviceType; model: StitchModel; section?: string }
export interface VariantsPayload { prompt: string; pageId: string; count: number; creativeRange: 'REFINE' | 'EXPLORE' | 'REIMAGINE'; deviceType: DeviceType; model: StitchModel }
export interface ImprovePayload { pageId: string; instructions?: string; autoIterate: boolean; maxIterations: number; targetScore: number; deviceType: DeviceType; model: StitchModel; importAssetBase64?: string; importExt?: '.html' | '.png' | '.jpg' | '.jpeg' | '.webp' }

type Payload = GeneratePayload | EditPayload | VariantsPayload | ImprovePayload | LogoJobInput;

interface QueueItem { jobId: string; priority: boolean }
const queue: QueueItem[] = [];
let running = 0;
const cancelled = new Set<string>();

const jobRef = (id: string) => db().collection(C.jobs).doc(id);

export class JobCancelled extends Error {}

export interface JobCtx {
  job: GenerationJob & { payload: Payload };
  stage: (name: string, progress: number) => Promise<void>;
  checkCancelled: () => Promise<void>;
  timed: <T>(p: Promise<T>, label: string) => Promise<T>;
}

export async function enqueue(params: {
  ownerId: string; projectId: string; type: JobType; prompt: string; payload: Payload;
  op: CreditOperation; multiplier?: number; idempotencyKey: string; priority: boolean;
  deviceType?: DeviceType; model?: StitchModel;
}): Promise<GenerationJob> {
  // Idempotent enqueue: same client key returns the same job.
  const jobId = `job_${params.ownerId.slice(0, 8)}_${params.idempotencyKey}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  const existing = await jobRef(jobId).get();
  if (existing.exists) return existing.data() as GenerationJob;

  const r = await credits.reserve(params.ownerId, params.op, params.idempotencyKey, params.multiplier ?? 1, { projectId: params.projectId, type: params.type });
  const now = Date.now();
  const job: GenerationJob & { payload: Payload } = {
    id: jobId, ownerId: params.ownerId, projectId: params.projectId, type: params.type, status: 'queued',
    prompt: params.prompt.slice(0, 4000), deviceType: params.deviceType, model: params.model,
    progress: 0, stage: 'Queued', creditsReserved: r.amount, creditTxnId: r.txnId, createdAt: now, updatedAt: now,
    payload: params.payload,
  };
  await jobRef(jobId).set(stripUndefined(job));
  if (params.priority) queue.unshift({ jobId, priority: true });
  else queue.push({ jobId, priority: false });
  setImmediate(pump);
  const { payload: _p, ...publicJob } = job;
  return publicJob;
}

export async function cancelJob(jobId: string, uid: string) {
  const snap = await jobRef(jobId).get();
  if (!snap.exists || snap.get('ownerId') !== uid) throw new AppError(404, 'NOT_FOUND', 'Job not found');
  const status = snap.get('status');
  if (status !== 'queued' && status !== 'running') return snap.data();
  cancelled.add(jobId);
  await jobRef(jobId).update({ cancelRequested: true, updatedAt: Date.now() });
  const idx = queue.findIndex((q) => q.jobId === jobId);
  if (idx >= 0) { queue.splice(idx, 1); await finish(snap.data() as GenerationJob, 'cancelled'); }
  return (await jobRef(jobId).get()).data();
}

function pump() {
  while (running < env.MAX_CONCURRENT_JOBS && queue.length) {
    const item = queue.shift()!;
    running++;
    run(item.jobId).finally(() => { running--; setImmediate(pump); });
  }
}

async function finish(job: GenerationJob, status: 'succeeded' | 'failed' | 'cancelled', extra: Partial<GenerationJob> = {}) {
  await jobRef(job.id).update(stripUndefined({ status, progress: status === 'succeeded' ? 100 : job.progress, updatedAt: Date.now(), ...extra }));
  if (status !== 'succeeded' && job.creditTxnId) {
    await credits.refund(job.creditTxnId, status === 'cancelled' ? 'Cancelled by user' : `Failed: ${extra.error?.code ?? 'error'}`);
  } else if (job.creditTxnId) {
    await credits.commit(job.creditTxnId).catch(() => undefined);
  }
  cancelled.delete(job.id);
}

async function run(jobId: string) {
  const snap = await jobRef(jobId).get();
  if (!snap.exists) return;
  const job = snap.data() as GenerationJob & { payload: Payload };
  if (job.status !== 'queued') return;
  await jobRef(jobId).update({ status: 'running', stage: 'Starting', updatedAt: Date.now() });

  const ctx: JobCtx = {
    job,
    stage: async (name, progress) => { job.progress = progress; await jobRef(jobId).update({ stage: name, progress, updatedAt: Date.now() }); },
    checkCancelled: async () => { if (cancelled.has(jobId)) throw new JobCancelled(); },
    timed: (p, label) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new AppError(504, 'TIMEOUT', `${label} timed out`)), env.JOB_TIMEOUT_MS))]),
  };

  try {
    let resultVersionIds: string[] = [];
    switch (job.type) {
      case 'generate': resultVersionIds = await runGenerate(ctx); break;
      case 'edit': case 'chat': resultVersionIds = await runEdit(ctx); break;
      case 'variants': resultVersionIds = await runVariants(ctx); break;
      case 'improve': resultVersionIds = await runImprove(ctx); break;
      case 'logo': resultVersionIds = await runLogoJob(ctx); break;
    }
    await finish(job, 'succeeded', { resultVersionIds, stage: 'Completed' });
    await db().collection(C.generations).add({ ownerId: job.ownerId, projectId: job.projectId, jobId, type: job.type, status: 'succeeded', versionIds: resultVersionIds, createdAt: Date.now() });
    await track(`gen_success_${job.type}`);
    await notify(job.ownerId, 'generation_completed', 'Design ready', `Your ${job.type} job finished.`, { projectId: job.projectId, jobId });
    const bal = await credits.getBalance(job.ownerId);
    if (bal < 10) await notify(job.ownerId, 'credits_low', 'Credits running low', `You have ${bal} credits left.`);
  } catch (e) {
    if (e instanceof JobCancelled) {
      await finish(job, 'cancelled', { stage: 'Cancelled' });
      return;
    }
    const err = e instanceof AppError ? { code: e.code, message: e.message } : { code: 'INTERNAL_ERROR', message: 'Generation failed unexpectedly.' };
    if (!(e instanceof AppError)) logger.error({ err: e, jobId }, 'job crashed');
    await finish(job, 'failed', { error: err, stage: 'Failed' });
    await db().collection(C.generations).add({ ownerId: job.ownerId, projectId: job.projectId, jobId, type: job.type, status: 'failed', error: err, createdAt: Date.now() });
    await track(`gen_failed_${job.type}`);
    await notify(job.ownerId, 'generation_failed', 'Generation failed', err.message + ' Credits were refunded.', { projectId: job.projectId, jobId });
  }
}

/** Boot-time recovery: jobs interrupted by a restart are failed and refunded. */
export async function recoverInterruptedJobs() {
  const snap = await db().collection(C.jobs).where('status', 'in', ['queued', 'running']).limit(200).get();
  for (const d of snap.docs) {
    await finish(d.data() as GenerationJob, 'failed', { error: { code: 'INTERRUPTED', message: 'The server restarted while this job was running. Credits refunded — please retry.' } });
  }
  if (snap.size) logger.info({ count: snap.size }, 'recovered interrupted jobs');
}

// ───────────────────────── runners ─────────────────────────

async function ensureStitchProject(project: Project, uid: string, ctx: JobCtx) {
  if (project.stitchProjectId) return project.stitchProjectId;
  await ctx.stage('Creating Stitch project in your account', 8);
  const id = await ctx.timed(stitchEngine.ensureProject(uid, `DesignForge · ${project.name}`), 'Create project');
  await db().collection(C.projects).doc(project.id).update({ stitchProjectId: id });
  project.stitchProjectId = id;
  return id;
}

async function saveScreen(ctx: JobCtx, project: Project, pageId: string, r: { html: string; imageUrl?: string; screenId: string }, source: any, prompt: string, parentVersionId?: string, setHead = true) {
  const imageUrl = r.imageUrl ? await persistRemoteImage(project.ownerId, r.imageUrl, { projectId: project.id }) : undefined;
  const audit = auditHtml(r.html, project.kind as ProjectKind, project.deviceType);
  return createVersion({
    projectId: project.id, ownerId: project.ownerId, pageId, parentVersionId, source, prompt,
    html: r.html, imageUrl, stitchScreenId: r.screenId, audit, isVariant: !setHead,
  }, setHead);
}

async function runGenerate(ctx: JobCtx) {
  const p = ctx.job.payload as GeneratePayload;
  const project = await loadProject(ctx.job.projectId, ctx.job.ownerId, 'editor');
  await ctx.stage('Analyzing prompt', 4);
  let pageId = p.pageId;
  if (!pageId) {
    pageId = newId('pg_');
    const pages = [...project.pages, { id: pageId, name: (p.newPageName || `Page ${project.pages.length + 1}`).slice(0, 60) }];
    await db().collection(C.projects).doc(project.id).update({ pages });
    project.pages = pages;
  }
  const pageName = project.pages.find((x) => x.id === pageId)?.name;
  const prompt = enrichPrompt(p.prompt, project.kind, { category: p.category, pages: pageName ? [pageName] : [], style: p.style });
  const sid = await ensureStitchProject(project, ctx.job.ownerId, ctx);
  await ctx.checkCancelled();
  await ctx.stage('Generating with Google Stitch (30–120s)', 20);
  const r = await ctx.timed(stitchEngine.generate(ctx.job.ownerId, sid, prompt, p.deviceType, p.model), 'Stitch generation');
  await ctx.checkCancelled();
  await ctx.stage('Auditing & saving version', 85);
  const v = await saveScreen(ctx, project, pageId, r, 'stitch_generate', p.prompt);
  return [v.id];
}

async function runEdit(ctx: JobCtx) {
  const p = ctx.job.payload as EditPayload;
  const project = await loadProject(ctx.job.projectId, ctx.job.ownerId, 'editor');
  const page = project.pages.find((x) => x.id === p.pageId);
  if (!page?.stitchScreenId) throw new AppError(409, 'NO_SCREEN', 'This page has no Stitch screen yet. Generate it first.');
  const sid = await ensureStitchProject(project, ctx.job.ownerId, ctx);
  const prompt = p.section
    ? `Only modify the section "${p.section}". Keep every other part of the screen identical. Change: ${p.prompt}`
    : p.prompt;
  await ctx.stage(p.section ? `Regenerating section "${p.section}"` : 'Applying edit with Stitch', 25);
  const r = await ctx.timed(stitchEngine.edit(ctx.job.ownerId, sid, page.stitchScreenId, prompt, p.deviceType, p.model), 'Stitch edit');
  await ctx.checkCancelled();
  await ctx.stage('Saving version', 85);
  const v = await saveScreen(ctx, project, page.id, r, 'stitch_edit', p.prompt, page.currentVersionId);
  return [v.id];
}

async function runVariants(ctx: JobCtx) {
  const p = ctx.job.payload as VariantsPayload;
  const project = await loadProject(ctx.job.projectId, ctx.job.ownerId, 'editor');
  const page = project.pages.find((x) => x.id === p.pageId);
  if (!page?.stitchScreenId) throw new AppError(409, 'NO_SCREEN', 'Generate the page before requesting variations.');
  const sid = await ensureStitchProject(project, ctx.job.ownerId, ctx);
  await ctx.stage(`Generating ${p.count} variations`, 25);
  const results = await ctx.timed(stitchEngine.variants(ctx.job.ownerId, sid, page.stitchScreenId, p.prompt, p.count, p.creativeRange, p.deviceType, p.model), 'Stitch variants');
  await ctx.checkCancelled();
  await ctx.stage('Saving variations', 85);
  const ids: string[] = [];
  for (const r of results) ids.push((await saveScreen(ctx, project, page.id, r, 'stitch_variant', p.prompt, page.currentVersionId, false)).id);
  return ids;
}

/**
 * Automatic Design Improvement Engine (Stages 1–9).
 */
async function runImprove(ctx: JobCtx) {
  const p = ctx.job.payload as ImprovePayload;
  const uid = ctx.job.ownerId;
  const project = await loadProject(ctx.job.projectId, uid, 'editor');
  let page = project.pages.find((x) => x.id === p.pageId)!;
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Page not found');
  const sid = await ensureStitchProject(project, uid, ctx);
  const produced: string[] = [];

  // Stage 1–2: import an existing design if supplied (official SDK upload), else use current head.
  if (p.importAssetBase64 && p.importExt) {
    await ctx.stage('Stage 1–2 · Importing your existing design into Stitch', 8);
    const imported = await ctx.timed(stitchEngine.importAsset(uid, sid, Buffer.from(p.importAssetBase64, 'base64'), p.importExt, page.name), 'Import');
    if (!imported.length) throw new AppError(422, 'IMPORT_FAILED', 'Stitch could not import that file.');
    const v = await saveScreen(ctx, project, page.id, imported[0], 'improve', 'Imported original');
    produced.push(v.id);
    page = { ...page, currentVersionId: v.id, stitchScreenId: imported[0].screenId };
    // Clear the large payload from the job doc once used.
    await jobRef(ctx.job.id).update({ 'payload.importAssetBase64': '' });
  }
  if (!page.currentVersionId || !page.stitchScreenId) throw new AppError(409, 'NO_SCREEN', 'Generate or import a design before improving it.');

  let current = await getVersion(page.currentVersionId, uid);
  let currentAudit = current.audit ?? auditHtml(current.html, project.kind, project.deviceType);
  let screenId = page.stitchScreenId;
  const history: unknown[] = [];

  for (let it = 1; it <= p.maxIterations; it++) {
    await ctx.checkCancelled();
    const base = 10 + ((it - 1) / p.maxIterations) * 80;
    await ctx.stage(`Iteration ${it} · Stage 3–4 · Inspecting design quality`, base);
    const plan = buildImprovementPlan(currentAudit, p.instructions);
    if (!plan.items.length && !p.instructions && it > 1) break;
    await ctx.stage(`Iteration ${it} · Stage 5 · Improvement plan (${plan.items.length} fixes)`, base + 5);

    // Iterations after the first reserve their own credits (idempotent per iteration).
    let iterTxn: string | undefined;
    if (it > 1) {
      try { iterTxn = (await credits.reserve(uid, 'improve_iteration', `${ctx.job.id}_it${it}`)).txnId; }
      catch { await ctx.stage('Stopped: not enough credits for another iteration', base + 5); break; }
    }
    try {
      await ctx.stage(`Iteration ${it} · Stage 6–7 · Applying fixes via Stitch`, base + 10);
      const r = await ctx.timed(stitchEngine.edit(uid, sid, screenId, plan.prompt, p.deviceType, p.model), 'Stitch improve');
      await ctx.checkCancelled();
      const v = await saveScreen(ctx, project, page.id, r, 'improve', plan.prompt, current.id);
      const cmp = compareAudits(currentAudit, v.audit!);
      history.push({ iteration: it, fromVersionId: current.id, toVersionId: v.id, before: currentAudit.score, after: v.audit!.score, ...cmp, plan: plan.items.map((i) => i.label) });
      await ctx.stage(`Iteration ${it} · Stage 8 · Compared: ${currentAudit.score} → ${v.audit!.score}`, base + 20);
      produced.push(v.id);
      if (iterTxn) await credits.commit(iterTxn);
      current = v; currentAudit = v.audit!; screenId = r.screenId;
      await jobRef(ctx.job.id).update({ improvementHistory: history });
      if (!p.autoIterate || currentAudit.score >= p.targetScore) break;
      if (cmp.scoreDelta <= 0 && it > 1) break; // stop when no further measurable gain
    } catch (e) {
      if (iterTxn) await credits.refund(iterTxn, 'Iteration failed');
      throw e;
    }
  }
  await ctx.stage('Stage 9 · Final result ready', 98);
  return produced;
}

function stripUndefined<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

/** Hourly: expire lapsed subscriptions and warn about upcoming expiry. */
export function startSchedulers() {
  const tick = async () => {
    try {
      const now = Date.now();
      const soon = await db().collection(C.subscriptions).where('status', '==', 'active').where('currentPeriodEnd', '<', now + 3 * 86400_000).limit(200).get();
      for (const d of soon.docs) {
        const s = d.data();
        if (s.planId === 'lifetime' || s.planId === 'free') continue;
        if (s.currentPeriodEnd < now && !s.razorpaySubscriptionId) {
          await d.ref.update({ status: 'expired', updatedAt: now });
          await notify(d.id, 'subscription_expired', 'Subscription expired', 'Your plan has expired and you are now on Free. Renew any time.');
        } else if (s.currentPeriodEnd > now && !s.expiryWarned) {
          await d.ref.update({ expiryWarned: true });
          await notify(d.id, 'subscription_expiring', 'Subscription ending soon', 'Your plan renews or ends within 3 days.');
        }
      }
    } catch (e) { logger.warn({ err: e }, 'scheduler tick failed'); }
  };
  setInterval(tick, 3600_000).unref();
  setTimeout(tick, 15_000).unref();
}
