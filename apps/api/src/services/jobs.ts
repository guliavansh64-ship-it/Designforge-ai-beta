import type { CreditOperation, DeviceType, GenerationJob, JobType, Project, ProjectKind, StitchModel } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { env } from '../config.js';
import { stitchEngine } from './stitch.js';
import { auditHtml, buildImprovementPlan, compareAudits, enrichPrompt } from './audit.js';
import { createVersion, getVersion, loadProject } from './repo.js';
import { persistRemoteImage, putBlob } from './blobs.js';
import * as credits from './credits.js';
import { notify, track } from './notify.js';
import { runLogoJob, type LogoJobInput } from './logos.js';
import { safeQuery } from '../lib/safeQuery.js';
import { enhance, enhanceEditInstruction, stitchPromptFor, type DesignPlan, type OutputMode } from './promptEnhancer.js';
import { publicApiUrl } from '../config.js';

/**
 * In-process job queue (free-tier friendly; single API instance).
 * - Job state is persisted in Firestore `generation_jobs` so clients poll and survive restarts.
 * - Priority lane for plans with `priority_queue`.
 * - Every job: credits reserved BEFORE enqueue → committed on success → refunded on failure/cancel.
 * - Cancellation is cooperative: checked between stages. An in-flight Stitch call cannot be
 *   aborted (SDK has no abort signal), but its result is discarded and credits refunded.
 * Scale-out path: replace `enqueue` with Cloud Tasks / BullMQ — runners are pure functions.
 */

export interface GeneratePayload { chat?: boolean; prompt: string; deviceType: DeviceType; model: StitchModel; pageId?: string; newPageName?: string; category?: string; style?: string; enhance?: boolean; mode?: OutputMode; maxScreens?: number; plan?: DesignPlan; pageNames?: string[] }
export interface EditPayload { chat?: boolean; prompt: string; pageId: string; deviceType: DeviceType; model: StitchModel; section?: string }
export interface VariantsPayload { chat?: boolean; prompt: string; pageId: string; count: number; creativeRange: 'REFINE' | 'EXPLORE' | 'REIMAGINE'; deviceType: DeviceType; model: StitchModel }
export interface ImprovePayload { chat?: boolean; pageId: string; instructions?: string; autoIterate: boolean; maxIterations: number; targetScore: number; deviceType: DeviceType; model: StitchModel; importAssetBase64?: string; importExt?: '.html' | '.png' | '.jpg' | '.jpeg' | '.webp' }

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

/**
 * Render's free plan sleeps after ~15 min without inbound traffic, killing in-flight Stitch calls.
 * While jobs are running we ping our own public /health every 4 min so the instance stays awake.
 */
let keepAlive: ReturnType<typeof setInterval> | null = null;
function syncKeepAlive() {
  const busy = running > 0 || queue.length > 0;
  if (busy && !keepAlive && env.NODE_ENV === 'production') {
    keepAlive = setInterval(() => { fetch(`${publicApiUrl()}/health`).catch(() => undefined); }, 4 * 60_000);
    keepAlive.unref?.();
  } else if (!busy && keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

function pump() {
  syncKeepAlive();
  while (running < env.MAX_CONCURRENT_JOBS && queue.length) {
    const item = queue.shift()!;
    running++;
    run(item.jobId).finally(() => { running--; setImmediate(pump); });
  }
  syncKeepAlive();
}

async function finish(job: GenerationJob, status: 'succeeded' | 'failed' | 'cancelled', extra: Partial<GenerationJob> = {}) {
  await jobRef(job.id).update(stripUndefined({ status, progress: status === 'succeeded' ? 100 : job.progress, updatedAt: Date.now(), ...extra }));
  if (status !== 'succeeded' && job.creditTxnId) {
    await credits.refund(job.creditTxnId, status === 'cancelled' ? 'Cancelled by user' : `Failed: ${extra.error?.code ?? 'error'}`);
  } else if (job.creditTxnId) {
    await credits.commit(job.creditTxnId).catch(() => undefined);
  }
  cancelled.delete(job.id);
  // Jobs started from the Assistant chat answer back in the chat thread.
  const pl = (job as GenerationJob & { payload?: { chat?: boolean; pageId?: string } }).payload;
  if (pl?.chat) {
    const text = status === 'succeeded'
      ? (job.type === 'variants' ? '✅ Done — variations are saved on this page (open the project to compare them).' : job.type === 'generate' ? '✅ Done — the new page is ready in your project.' : '✅ Done — your change is applied and saved as a new version. Open the preview to see it; you can restore the old version any time.')
      : status === 'cancelled' ? 'Cancelled. No credits were used.'
        : `⚠️ That didn't work: ${extra.error?.message ?? 'unknown error'} Your credits were refunded — try again or rephrase.`;
    await db().collection(C.chat).add({ ownerId: job.ownerId, projectId: job.projectId, pageId: pl.pageId ?? null, role: 'assistant', text, jobId: job.id, createdAt: Date.now() }).catch(() => undefined);
  }
}

/** Low-credit push at most once a day. */
async function maybeNotifyLowCredits(uid: string) {
  const bal = await credits.getBalance(uid);
  if (bal >= 10) return;
  const ref = db().collection(C.users).doc(uid);
  const last = (await ref.get()).get('lowCreditsNotifiedAt') ?? 0;
  if (Date.now() - last < 24 * 3600_000) return;
  await ref.set({ lowCreditsNotifiedAt: Date.now() }, { merge: true });
  await notify(uid, 'credits_low', 'Credits running low ⚡', `You have ${bal} credits left. Top up with UPI to keep designing.`, { kind: 'billing' });
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
      case 'logo': resultVersionIds = await runLogoJob(ctx, {
        ensureProject: (proj) => ensureStitchProject(proj, ctx.job.ownerId, ctx),
        generate: (sid, prompt, label) => generateWithFallback(ctx, ctx.job.ownerId, sid, prompt, 'DESKTOP', undefined, label),
      }); break;
    }
    await finish(job, 'succeeded', { resultVersionIds, stage: 'Completed' });
    await db().collection(C.generations).add({ ownerId: job.ownerId, projectId: job.projectId, jobId, type: job.type, status: 'succeeded', versionIds: resultVersionIds, createdAt: Date.now() });
    await track(`gen_success_${job.type}`);
    const pname = (await db().collection(C.projects).doc(job.projectId).get().catch(() => null))?.get('name') ?? 'your project';
    const n = resultVersionIds.length;
    const doneMsg = job.type === 'generate' ? (n > 1 ? `${n} screens of "${pname}" are ready. Tap to view.` : `"${pname}" is ready. Tap to view.`)
      : job.type === 'variants' ? `${n} variations of "${pname}" are ready.` : job.type === 'logo' ? 'Your logo concepts are ready.' : `Your change to "${pname}" is applied.`;
    await notify(job.ownerId, 'generation_completed', 'Your design is ready ✨', doneMsg, { projectId: job.projectId, jobId });
    await maybeNotifyLowCredits(job.ownerId).catch(() => undefined);
  } catch (e) {
    if (e instanceof JobCancelled) {
      await finish(job, 'cancelled', { stage: 'Cancelled' });
      return;
    }
    const err = e instanceof AppError ? { code: e.code, message: e.message } : { code: 'INTERNAL_ERROR', message: 'Generation failed unexpectedly. Your credits were refunded — please try again.' };
    // Technical reason for admins (job doc only; the apps show `message`). Never contains keys: it's the exception text.
    const detail = e instanceof AppError ? undefined : String((e as Error)?.message ?? e).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').slice(0, 300);
    if (!(e instanceof AppError)) logger.error({ err: e, jobId }, 'job crashed');
    await finish(job, 'failed', { error: detail ? { ...err, detail } : err, stage: 'Failed' });
    await db().collection(C.generations).add({ ownerId: job.ownerId, projectId: job.projectId, jobId, type: job.type, status: 'failed', error: err, createdAt: Date.now() });
    await track(`gen_failed_${job.type}`);
    await notify(job.ownerId, 'generation_failed', 'Design failed', `${err.message} Credits were refunded.`, { projectId: job.projectId, jobId });
  }
}

/**
 * Recovery for jobs orphaned by a restart/crash: failed + refunded.
 *
 * Only STALE jobs are touched (no progress for longer than one full Stitch call can take), never
 * fresh ones. Render starts the new instance BEFORE stopping the old one during a deploy, so failing
 * every queued/running job at boot would kill generations the old instance is still finishing.
 * Runs at boot and then every 5 minutes, so orphans are still cleaned up shortly after.
 */
export async function recoverInterruptedJobs() {
  const staleBefore = Date.now() - (env.JOB_TIMEOUT_MS + 3 * 60_000);
  const snap = await db().collection(C.jobs).where('status', 'in', ['queued', 'running']).limit(200).get();
  let n = 0;
  for (const d of snap.docs) {
    const j = d.data() as GenerationJob & { updatedAt?: number };
    if ((j.updatedAt ?? j.createdAt ?? 0) > staleBefore) continue;
    await finish(j, 'failed', { error: { code: 'INTERRUPTED', message: 'The server restarted while this job was running. Credits refunded — please retry.' } });
    n++;
  }
  if (n) logger.info({ count: n }, 'recovered interrupted jobs');
}
let sweeper: ReturnType<typeof setInterval> | null = null;
export function startStaleJobSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => { recoverInterruptedJobs().catch((e) => logger.warn({ err: e }, 'stale job sweep failed')); }, 5 * 60_000);
  sweeper.unref();
}

// ───────────────────────── runners ─────────────────────────

async function ensureStitchProject(project: Project, uid: string, ctx: JobCtx) {
  if (project.stitchProjectId) return project.stitchProjectId;
  await ctx.stage('Creating Stitch project in your account', 8);
  const id = await ctx.timed(stitchEngine.ensureProject(uid, `Designo · ${project.name}`), 'Create project');
  await db().collection(C.projects).doc(project.id).update({ stitchProjectId: id });
  project.stitchProjectId = id;
  return id;
}

async function saveScreen(ctx: JobCtx, project: Project, pageId: string, r: { html: string; image?: { data: Buffer; mime: string }; imageUrl?: string; screenId: string }, source: any, prompt: string, parentVersionId?: string, setHead = true) {
  // Screenshot bytes come from Stitch's download_file tool; persist them so the apps can show thumbnails.
  const imageUrl = r.image
    ? await putBlob(project.ownerId, r.image.data, r.image.mime, { projectId: project.id }).then((b) => b.url).catch(() => undefined)
    : r.imageUrl ? await persistRemoteImage(project.ownerId, r.imageUrl, { projectId: project.id }) : undefined;
  const audit = auditHtml(r.html, project.kind as ProjectKind, project.deviceType);
  return createVersion({
    projectId: project.id, ownerId: project.ownerId, pageId, parentVersionId, source, prompt,
    html: r.html, imageUrl, stitchScreenId: r.screenId, audit, isVariant: !setHead,
  }, setHead);
}

async function runGenerate(ctx: JobCtx) {
  const p = ctx.job.payload as GeneratePayload;
  const uid = ctx.job.ownerId;
  const project = await loadProject(ctx.job.projectId, uid, 'editor');
  // A project that already has designs gets ONE more screen; a fresh project may become a full app.
  const hasDesigns = project.pages.some((x) => !!x.currentVersionId);
  const addingToExisting = hasDesigns || !!p.newPageName;
  const mode: OutputMode = addingToExisting ? 'single' : (p.mode ?? 'auto');

  // Enhancement is ALWAYS on (hidden from the user): Gemini (user's own key) or the built-in planner.
  // 1. Enhance the prompt (user's own Gemini key, else built-in planner) and plan the screens.
  const existingName = addingToExisting ? (p.pageId ? project.pages.find((x) => x.id === p.pageId)?.name : p.newPageName) : undefined;
  await ctx.stage('Understanding your idea', 3);
  const plan: DesignPlan = await ctx.timed(enhance(uid, {
    prompt: p.prompt, kind: project.kind, device: p.deviceType, style: p.style, category: p.category,
    mode, maxScreens: p.maxScreens ?? 5, pageName: existingName, pageNames: p.pageNames,
  }), 'Prompt enhancement');
  const total = plan.screens.length;
  await jobRef(ctx.job.id).update({ plan, screensTotal: total, screensDone: 0, updatedAt: Date.now() });
  await ctx.stage(total > 1 ? `Designing ${total} screens for ${plan.appName}` : `Designing ${plan.screens[0].name}`, 6);

  // Rename an untitled project after the planned app.
  if (!addingToExisting && /^(untitled|test|new project|my project)/i.test(project.name)) {
    await db().collection(C.projects).doc(project.id).update({ name: plan.appName, nameLower: plan.appName.toLowerCase() }).catch(() => undefined);
  }

  const sid = await ensureStitchProject(project, uid, ctx);
  const ids: string[] = [];
  let firstVersion: { id: string; imageUrl?: string } | undefined;
  const warnings: string[] = [];
  for (let i = 0; i < total; i++) {
    await ctx.checkCancelled();
    const screen = plan.screens[i];
    const span = 88 / total;
    const base = 8 + i * span;
    // Screen 1 was paid at enqueue; each further screen reserves its own credits (idempotent per screen).
    let txn: string | undefined;
    if (i > 0) {
      try { txn = (await credits.reserve(uid, 'generate_flash', `${ctx.job.id}_s${i}`, 1, { projectId: project.id, type: 'generate', screen: screen.name })).txnId; }
      catch { warnings.push(`Stopped after ${i} screens: not enough credits for "${screen.name}".`); break; }
    }
    try {
      const pageId = i === 0
        ? await firstPage(project, p, plan.isFullApp && !addingToExisting ? screen.name : undefined, !addingToExisting)
        : await ensurePage(project, undefined, screen.name);
      await ctx.stage(total > 1 ? `Screen ${i + 1}/${total} · ${screen.name} · generating with Stitch` : `Generating ${screen.name} with Google Stitch (30–120s)`, Math.round(base + 2));
      const r = await generateWithFallback(ctx, uid, sid, stitchPromptFor(plan, i, project.kind), p.deviceType, p.model, screen.name);
      await ctx.checkCancelled();
      await ctx.stage(total > 1 ? `Screen ${i + 1}/${total} · ${screen.name} · saving` : 'Auditing & saving version', Math.round(base + span * 0.85));
      const v = await saveScreen(ctx, project, pageId, r, 'stitch_generate', i === 0 ? p.prompt : `${plan.appName} · ${screen.name}`);
      ids.push(v.id);
      if (!firstVersion) firstVersion = v;
      if (txn) await credits.commit(txn);
      await jobRef(ctx.job.id).update({ screensDone: ids.length, resultVersionIds: ids, updatedAt: Date.now() });
    } catch (e) {
      if (txn) await credits.refund(txn, `Screen failed: ${screen.name}`).catch(() => undefined);
      if (e instanceof JobCancelled) { if (ids.length) break; throw e; }
      // First screen failing fails the whole job (and refunds it). Later failures keep finished screens.
      if (i === 0 || !ids.length) throw e;
      const msg = e instanceof AppError ? e.message : 'unexpected error';
      warnings.push(`"${screen.name}" could not be generated (${msg.slice(0, 160)}). Its credits were refunded.`);
      if (e instanceof AppError && [401, 403, 412, 429].includes(e.status)) break;
    }
  }
  if (warnings.length) await jobRef(ctx.job.id).update({ warnings });
  // The project card should show the app's first (home) screen, not whichever finished last.
  if (ids.length > 1 && firstVersion) {
    await db().collection(C.projects).doc(project.id).update({ currentVersionId: firstVersion.id, ...(firstVersion.imageUrl ? { thumbnailUrl: firstVersion.imageUrl } : {}) }).catch(() => undefined);
  }
  return ids;
}

/**
 * Read-modify-write of the project's pages inside a transaction. The in-memory `project.pages` goes
 * stale as soon as createVersion() moves a page head, so never write it back blindly.
 */
async function mutatePages(project: Project, fn: (pages: Project['pages']) => Project['pages']) {
  const ref = db().collection(C.projects).doc(project.id);
  const pages = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = fn(((snap.get('pages') as Project['pages']) ?? []).map((x) => ({ ...x })));
    tx.update(ref, { pages: next, updatedAt: Date.now() });
    return next;
  });
  project.pages = pages;
  return pages;
}

/** Page for the first screen: the requested page (renamed for a full app when still empty) or a new/reused one. */
async function firstPage(project: Project, p: GeneratePayload, renameTo: string | undefined, fresh: boolean) {
  if (p.pageId) {
    const pg = project.pages.find((x) => x.id === p.pageId);
    if (pg && renameTo && !pg.currentVersionId && pg.name !== renameTo) {
      await mutatePages(project, (pages) => pages.map((x) => (x.id === pg.id && !x.currentVersionId ? { ...x, name: renameTo.slice(0, 60) } : x)));
    }
    return p.pageId;
  }
  return ensurePage(project, undefined, p.newPageName || renameTo, fresh);
}

/**
 * Returns the page to write into. With `reuseEmptyFirst`, the project's first page is reused when
 * it has no design yet (new projects are created with an empty "Screen 1"/"Home" page), renamed to `name`.
 */
async function ensurePage(project: Project, pageId?: string, name?: string, reuseEmptyFirst = false) {
  if (pageId) return pageId;
  let chosen = '';
  await mutatePages(project, (pages) => {
    const first = pages[0];
    if (reuseEmptyFirst && pages.length === 1 && first && !first.currentVersionId) {
      chosen = first.id;
      return [{ ...first, name: (name || first.name).slice(0, 60) }];
    }
    chosen = newId('pg_');
    return [...pages, { id: chosen, name: (name || `Page ${pages.length + 1}`).slice(0, 60) }];
  });
  return chosen;
}

/**
 * Automatic model choice: Stitch's best model first; if Stitch times out / errors internally / keeps
 * asking questions, retry once on the fast model with a condensed prompt so the user still gets a design.
 */
async function generateWithFallback(ctx: JobCtx, uid: string, sid: string, prompt: string, device: DeviceType, model: StitchModel | undefined, label: string) {
  const primary: StitchModel = model ?? 'GEMINI_3_8_FLASH';
  try {
    return await ctx.timed(stitchEngine.generate(uid, sid, prompt, device, primary), `Stitch generation (${label})`);
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'INTERNAL_ERROR';
    const status = e instanceof AppError ? e.status : 500;
    const retryable = ['TIMEOUT', 'STITCH_CLARIFICATION', 'STITCH_ERROR', 'STITCH_UNAVAILABLE', 'INTERNAL_ERROR', 'STITCH_EMPTY_RESULT'].includes(code) || status >= 500 || status === 422;
    if (!retryable || e instanceof JobCancelled) throw e;
    await ctx.checkCancelled();
    logger.info({ code, label }, 'stitch generation failed; retrying on the fast model');
    await ctx.stage(`Retrying ${label} with the fast model`, Math.max(ctx.job.progress ?? 10, 10));
    const condensed = `${prompt.slice(0, 3500)}\n\nGenerate this single screen now. Do not ask questions; make sensible assumptions.`;
    return ctx.timed(stitchEngine.generate(uid, sid, condensed, device, 'GEMINI_3_5_FLASH_LITE'), `Stitch generation (${label}, fast)`);
  }
}

async function runEdit(ctx: JobCtx) {
  const p = ctx.job.payload as EditPayload;
  const project = await loadProject(ctx.job.projectId, ctx.job.ownerId, 'editor');
  const page = project.pages.find((x) => x.id === p.pageId);
  if (!page?.stitchScreenId) throw new AppError(409, 'NO_SCREEN', 'This page has no Stitch screen yet. Generate it first.');
  const sid = await ensureStitchProject(project, ctx.job.ownerId, ctx);
  await ctx.stage('Understanding your request', 10);
  // Small Gemini task (user's own key): make the short request precise. Never shown to the user.
  const instruction = await enhanceEditInstruction(ctx.job.ownerId, p.prompt, { pageName: page.name, section: p.section });
  const prompt = p.section
    ? `Only modify the section "${p.section}". Keep every other part of the screen identical. Change: ${instruction}`
    : instruction;
  await ctx.stage(p.section ? `Updating the ${p.section} section with Stitch (30–120s)` : 'Applying your change with Stitch (30–120s)', 25);
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
      const soon = { docs: await safeQuery(db().collection(C.subscriptions), { where: [['status', '==', 'active'], ['currentPeriodEnd', '<', now + 3 * 86400_000]], limit: 200, fallbackCap: 2000 }) };
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
