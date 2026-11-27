import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeDb } from './fakeFirestore.js';

const fake = createFakeDb();
const C = { projects: 'projects', versions: 'project_versions', assets: 'assets' };
vi.mock('../src/lib/firebase.js', () => ({ db: () => fake.db, C }));
let n = 0;
vi.mock('../src/services/blobs.js', () => ({
  putBlob: vi.fn(async () => { n++; return { id: `as_${n}`, url: `/api/assets/as_${n}` }; }),
  getBlob: vi.fn(),
}));
vi.mock('../src/services/repo.js', async (orig) => ({
  ...(await orig<any>()),
  loadProject: async (id: string) => ({ ...(await fake.db.collection('projects').doc(id).get()).data(), access: 'owner' }),
}));
const { runLogoJob } = await import('../src/services/logos.js');

/** A Stitch-like rendering: a purple mark on a big white desktop canvas. */
async function stitchShot() {
  const mark = await sharp({ create: { width: 220, height: 90, channels: 3, background: '#7c5cff' } }).png().toBuffer();
  return sharp({ create: { width: 1280, height: 1024, channels: 3, background: '#ffffff' } }).composite([{ input: mark, left: 520, top: 460 }]).png().toBuffer();
}

describe('logo job (Stitch)', () => {
  it('designs each concept with Stitch and saves it as the page head — logo pages have no Stitch screen id', async () => {
    await fake.db.collection('projects').doc('p1').set({ id: 'p1', ownerId: 'u1', name: 'Designo brand', kind: 'logo', pages: [] });
    const prompts: string[] = [];
    const stitch = {
      ensureProject: vi.fn(async () => 'sp_1'),
      generate: vi.fn(async (_sid: string, prompt: string) => { prompts.push(prompt); return { html: '<html><body>logo</body></html>', screenId: `scr_${prompts.length}`, image: { data: await stitchShot(), mime: 'image/png' } }; }),
    };
    const stages: string[] = [];
    const ctx: any = {
      job: { id: 'j1', ownerId: 'u1', projectId: 'p1', payload: { brandName: 'Designo', industry: 'Design', styles: ['Minimalist', 'Icon'], count: 2 } },
      checkCancelled: async () => undefined, stage: async (s: string) => { stages.push(s); }, timed: (p: any) => p,
    };
    const ids = await runLogoJob(ctx, stitch);
    expect(ids).toHaveLength(2);
    expect(stitch.generate).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toMatch(/minimalist LOGO for a brand named "Designo"/);
    expect(prompts[1]).toMatch(/ONLY a simple, memorable symbol \(no text/);
    expect(stages[0]).toMatch(/with Google Stitch/);
    const p = (await fake.db.collection('projects').doc('p1').get()).data()!;
    expect(p.pages).toHaveLength(2);
    expect(p.pages.every((pg: any) => ids.includes(pg.currentVersionId))).toBe(true);
    const v = (await fake.db.collection('project_versions').doc(ids[0]).get()).data()!;
    expect(v.source).toBe('logo');
    expect(v.stitchScreenId).toBe('scr_1');
    expect(v.logo.palette[0]).toMatch(/^#/);
    expect(Object.values(v.logo.assets).filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});
