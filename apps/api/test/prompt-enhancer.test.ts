import { beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.fn();
const generateJson = vi.fn();
vi.mock('../src/services/connections.js', () => ({ listConnectionStatus: (...a: unknown[]) => status(...a), getCredential: vi.fn(), markConnection: vi.fn() }));
vi.mock('../src/services/gemini.js', () => ({ gemini: { generateJson: (...a: unknown[]) => generateJson(...a) } }));
const { enhance, planBuiltIn, stitchPromptFor, looksLikeFullAppRequest } = await import('../src/services/promptEnhancer.js');

const base = { kind: 'ui' as const, device: 'MOBILE' as const, maxScreens: 5 };

describe('built-in planner (no Gemini key)', () => {
  it('turns "create a fitness app" into a complete themed multi-screen app', () => {
    const plan = planBuiltIn({ ...base, prompt: 'create a fitness app', mode: 'auto' });
    expect(plan.isFullApp).toBe(true);
    expect(plan.category).toBe('fitness');
    expect(plan.screens).toHaveLength(5);
    expect(plan.screens.map((s) => s.name)).toContain('Workouts');
    expect(plan.theme.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('keeps a specific screen request as one screen', () => {
    expect(looksLikeFullAppRequest('a login screen for a fitness app')).toBe(false);
    const plan = planBuiltIn({ ...base, prompt: 'a login screen for a fitness app', mode: 'auto' });
    expect(plan.isFullApp).toBe(false);
    expect(plan.screens).toHaveLength(1);
    expect(plan.screens[0].prompt).toContain('a login screen for a fitness app');
  });

  it('plans website pages for website projects and honours "named X"', () => {
    const plan = planBuiltIn({ ...base, kind: 'website', device: 'DESKTOP', prompt: 'website for my bakery named Sweet Crumbs', mode: 'app', maxScreens: 4 });
    expect(plan.appName).toBe('Sweet Crumbs');
    expect(plan.screens.map((s) => s.name)).toEqual(['Home', 'About', 'Services', 'Contact']);
  });
});

describe('Stitch prompt for each screen', () => {
  it('carries the shared theme, navigation and no-questions instruction', () => {
    const plan = planBuiltIn({ ...base, prompt: 'create a fitness app', mode: 'app' });
    const p = stitchPromptFor(plan, 1, 'ui');
    expect(p).toContain('PulseFit: Workouts screen');
    expect(p).toContain(plan.theme.primary);
    expect(p).toContain('screen 2 of 5');
    expect(p).toContain('bottom tab bar: Home, Workouts, Progress, Profile');
    expect(p).toMatch(/Do not ask clarifying questions/);
  });
});

describe('enhance()', () => {
  beforeEach(() => { status.mockReset(); generateJson.mockReset(); });

  it('uses the user\'s own Gemini key when connected', async () => {
    status.mockResolvedValue([{ provider: 'gemini', connected: true }]);
    generateJson.mockResolvedValue({
      appName: 'IronPath', category: 'fitness', isFullApp: true,
      theme: { mood: 'bold', primary: '#FF5500', accent: '#00AAFF', background: '#0A0A0A', dark: true, headingFont: 'Sora', bodyFont: 'Inter', corners: 'rounded 16px' },
      designBrief: 'Strength training app.', navigation: ['Home', 'Plans', 'Stats', 'Me'],
      screens: [{ name: 'Home', prompt: 'Dashboard with today\'s lift and weekly volume chart and streak.' }, { name: 'Plans', prompt: 'Program library with filters and cards for each plan.' }, { name: 'Stats', prompt: 'Charts for volume, PRs and body weight over time.' }],
    });
    const plan = await enhance('u1', { ...base, prompt: 'create a fitness app', mode: 'auto' });
    expect(generateJson).toHaveBeenCalledOnce();
    expect(generateJson.mock.calls[0][0]).toBe('u1');
    expect(plan.enhancer).toBe('gemini');
    expect(plan.appName).toBe('IronPath');
    expect(plan.screens).toHaveLength(3);
  });

  it('falls back to the built-in planner when Gemini fails', async () => {
    status.mockResolvedValue([{ provider: 'gemini', connected: true }]);
    generateJson.mockRejectedValue(new Error('quota'));
    const plan = await enhance('u1', { ...base, prompt: 'create a fitness app', mode: 'auto' });
    expect(plan.enhancer).toBe('built-in');
    expect(plan.screens.length).toBe(5);
  });

  it('never calls Gemini without the user\'s own key', async () => {
    status.mockResolvedValue([{ provider: 'gemini', connected: false }]);
    const plan = await enhance('u2', { ...base, prompt: 'create a food delivery app', mode: 'single' });
    expect(generateJson).not.toHaveBeenCalled();
    expect(plan.screens).toHaveLength(1);
  });
});
