import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeFirestore.js';
import { CREDIT_COSTS } from '@designforge/shared';

const fake = createFakeDb();
const C = { wallets: 'credit_wallets', creditTxns: 'credit_transactions', jobs: 'generation_jobs', projects: 'projects', generations: 'generations' };
vi.mock('../src/lib/firebase.js', () => ({ db: () => fake.db, C }));
vi.mock('../src/services/plans.js', () => ({ getEntitlements: async () => ({ plan: { name: 'Free', monthlyCredits: 40, annualCredits: 480 }, sub: { cycle: 'none' } }) }));
vi.mock('../src/services/connections.js', () => ({ listConnectionStatus: async () => [{ provider: 'gemini', connected: false }] }));
vi.mock('../src/services/notify.js', () => ({ notify: vi.fn(async () => undefined), track: vi.fn(async () => undefined) }));
vi.mock('../src/services/logos.js', () => ({ runLogoJob: vi.fn() }));
vi.mock('../src/services/blobs.js', () => ({ putBlob: vi.fn(), persistRemoteImage: vi.fn(async () => undefined) }));
const prompts: string[] = [];
const models: string[] = [];
let failOn = -1;
let failStatus = 502;
let failCode = 'STITCH_ERROR';
vi.mock('../src/services/stitch.js', () => ({
  stitchEngine: {
    ensureProject: async () => 'sp_1',
    generate: async (_u: string, _p: string, prompt: string, _d: string, model: string) => {
      prompts.push(prompt); models.push(model);
      if (prompts.length - 1 === failOn) { const { AppError } = await import('../src/lib/errors.js'); throw new AppError(failStatus, failCode, 'boom'); }
      return { html: `<html><body><h1>${prompts.length}</h1></body></html>`, screenId: `scr_${prompts.length}` };
    },
  },
}));
vi.mock('../src/services/repo.js', () => ({
  loadProject: async (id: string) => { const s = await fake.db.collection('projects').doc(id).get(); return { id, ...s.data(), access: 'owner' }; },
  getVersion: vi.fn(),
  createVersion: async (input: any) => {
    const id = `v_${Math.random().toString(36).slice(2, 8)}`;
    const ref = fake.db.collection('projects').doc(input.projectId);
    const p = (await ref.get()).data()!;
    await ref.update({ pages: p.pages.map((pg: any) => (pg.id === input.pageId ? { ...pg, currentVersionId: id, stitchScreenId: input.stitchScreenId } : pg)) });
    return { id, ...input };
  },
}));
const jobs = await import('../src/services/jobs.js');
const credits = await import('../src/services/credits.js');

async function waitDone(id: string) {
  for (let i = 0; i < 200; i++) {
    const d = (await fake.db.collection('generation_jobs').doc(id).get()).data()!;
    if (['succeeded', 'failed', 'cancelled'].includes(d.status)) return d;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}
async function newProject() {
  await fake.db.collection('projects').doc('p1').set({ ownerId: 'u1', name: 'Untitled', kind: 'ui', deviceType: 'MOBILE', pages: [{ id: 'pg_first', name: 'Screen 1' }] });
}

describe('full-app generation job', () => {
  beforeEach(async () => { fake.store.clear(); prompts.length = 0; models.length = 0; failOn = -1; await newProject(); });

  it('"create a fitness app" → 4 themed screens on 4 pages, charged per screen', async () => {
    const job = await jobs.enqueue({ ownerId: 'u1', projectId: 'p1', type: 'generate', prompt: 'create a fitness app',
      payload: { prompt: 'create a fitness app', deviceType: 'MOBILE', model: 'GEMINI_3_8_FLASH', pageId: 'pg_first', enhance: true, mode: 'auto', maxScreens: 4 },
      op: 'generate_flash', idempotencyKey: 'fullapp-test-1', priority: false });
    const done = await waitDone(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.resultVersionIds).toHaveLength(4);
    expect(done.plan.appName).toBe('PulseFit');
    expect(done.screensDone).toBe(4);
    expect(prompts).toHaveLength(4);
    expect(prompts.every((p) => p.includes('#A3E635'))).toBe(true); // shared theme in every prompt
    const project = (await fake.db.collection('projects').doc('p1').get()).data()!;
    expect(project.name).toBe('PulseFit');
    expect(project.pages.map((p: any) => p.name)).toEqual(['Home', 'Workouts', 'Active workout', 'Progress']);
    expect(project.pages.every((p: any) => p.currentVersionId)).toBe(true);
    expect(await credits.getBalance('u1')).toBe(40 - 4 * CREDIT_COSTS.generate_flash);
  });

  it('a transient Stitch error is retried automatically on the fast model', async () => {
    failOn = 2; failStatus = 502; failCode = 'STITCH_ERROR';
    const job = await jobs.enqueue({ ownerId: 'u1', projectId: 'p1', type: 'generate', prompt: 'create a fitness app',
      payload: { prompt: 'create a fitness app', deviceType: 'MOBILE', model: 'GEMINI_3_8_FLASH', pageId: 'pg_first', enhance: true, mode: 'app', maxScreens: 4 },
      op: 'generate_flash', idempotencyKey: 'fullapp-test-retry', priority: false });
    const done = await waitDone(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.resultVersionIds).toHaveLength(4);
    expect(prompts).toHaveLength(5);
    expect(models[2]).toBe('GEMINI_3_8_FLASH');
    expect(models[3]).toBe('GEMINI_3_5_FLASH_LITE');
    expect(await credits.getBalance('u1')).toBe(40 - 4 * CREDIT_COSTS.generate_flash);
  });

  it('a failing later screen keeps finished screens and refunds only that screen', async () => {
    failOn = 2; failStatus = 400; failCode = 'STITCH_INVALID_REQUEST';
    const job = await jobs.enqueue({ ownerId: 'u1', projectId: 'p1', type: 'generate', prompt: 'create a fitness app',
      payload: { prompt: 'create a fitness app', deviceType: 'MOBILE', model: 'GEMINI_3_8_FLASH', pageId: 'pg_first', enhance: true, mode: 'app', maxScreens: 4 },
      op: 'generate_flash', idempotencyKey: 'fullapp-test-2', priority: false });
    const done = await waitDone(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.resultVersionIds).toHaveLength(3);
    expect(done.warnings[0]).toMatch(/could not be generated/);
    expect(await credits.getBalance('u1')).toBe(40 - 3 * CREDIT_COSTS.generate_flash);
  });

  it('automatic mode: a specific screen request gets exactly one (enhanced) screen on the given page', async () => {
    const job = await jobs.enqueue({ ownerId: 'u1', projectId: 'p1', type: 'generate', prompt: 'a login screen with email, password and Google sign-in',
      payload: { prompt: 'a login screen with email, password and Google sign-in', deviceType: 'MOBILE', model: 'GEMINI_3_8_FLASH', pageId: 'pg_first' },
      op: 'generate_flash', idempotencyKey: 'fullapp-test-3', priority: false });
    const done = await waitDone(job.id);
    expect(done.status).toBe('succeeded');
    expect(prompts).toHaveLength(1);
    const project = (await fake.db.collection('projects').doc('p1').get()).data()!;
    expect(project.pages).toHaveLength(1);
  });

  it('not enough credits for every screen → nothing generated, nothing charged, says how many fit', async () => {
    await credits.getBalance('u1');
    await fake.db.collection('credit_wallets').doc('u1').update({ balance: 12 });
    const job = await jobs.enqueue({ ownerId: 'u1', projectId: 'p1', type: 'generate', prompt: 'create a fitness app',
      payload: { prompt: 'create a fitness app', deviceType: 'MOBILE', model: 'GEMINI_3_8_FLASH', pageId: 'pg_first', enhance: true, mode: 'app', maxScreens: 4 },
      op: 'generate_flash', idempotencyKey: 'fullapp-test-short', priority: false });
    const done = await waitDone(job.id);
    expect(done.status).toBe('failed');
    expect(done.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(done.error.message).toMatch(/4 screens.*covers 2 screens.*Nothing was generated/);
    expect(prompts).toHaveLength(0);
    expect(await credits.getBalance('u1')).toBe(12);
  });
});
