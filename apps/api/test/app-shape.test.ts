import { describe, expect, it } from 'vitest';
import { chooseGenerateMode, EXPLICIT_FULL_APP, extractNavLabels, extractStyleHint } from '../src/services/appShape.js';

describe('app shape', () => {
  it('reads bottom-tab labels and ignores icon ligatures', () => {
    const html = '<nav class="fixed bottom-0"><a><span class="material-symbols-outlined">restaurant</span><span>Explore</span></a><button><span class="material-symbols-outlined">search</span>Browse</button><a>Orders</a><a>Profile</a></nav>';
    expect(extractNavLabels(html)).toEqual(['Explore', 'Browse', 'Orders', 'Profile']);
  });
  it('returns [] when there is no tab bar', () => { expect(extractNavLabels('<h1>Hi</h1>')).toEqual([]); });
  it('style hint lists colours and real fonts, not icon fonts', () => {
    const h = extractStyleHint('<link href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400"><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"><div style="color:#9d4300;background:#9d4300;border-color:#ffb690">');
    expect(h).toContain('#9d4300'); expect(h).toContain('Epilogue'); expect(h).not.toMatch(/Material/);
  });
  it('detects explicit complete-app wording', () => {
    for (const p of ['Create a complete app for food delivery', 'make the full app', 'design all screens of a gym app', 'a multi-screen banking app']) expect(EXPLICIT_FULL_APP.test(p)).toBe(true);
    for (const p of ['a login screen', 'A food delivery app', 'complete the checkout form']) expect(EXPLICIT_FULL_APP.test(p)).toBe(false);
  });
  it('new project with an empty first page is NOT forced to one screen', () => {
    const base = { hasDesigns: false, targetHasDesign: false, affordable: 80 };
    expect(chooseGenerateMode({ ...base, prompt: 'A creative earning app' }).mode).toBe('auto');
    expect(chooseGenerateMode({ ...base, prompt: 'Create a complete food app' }).mode).toBe('app');
    expect(chooseGenerateMode({ ...base, prompt: 'anything', requested: 'app' }).mode).toBe('app');
    expect(chooseGenerateMode({ ...base, prompt: 'a login screen', requested: 'single' }).mode).toBe('single');
    expect(chooseGenerateMode({ ...base, affordable: 1, prompt: 'Create a complete food app' }).error).toBe('needs_two');
    expect(chooseGenerateMode({ ...base, hasDesigns: true, prompt: 'A creative earning app' }).mode).toBe('single');
    expect(chooseGenerateMode({ ...base, hasDesigns: true, completeApp: true, prompt: 'x' }).mode).toBe('app');
  });
});
