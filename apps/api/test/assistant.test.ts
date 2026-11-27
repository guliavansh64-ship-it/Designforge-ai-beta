import { describe, expect, it } from 'vitest';
import { builtInAnswer, pageFactsFromHtml } from '../src/services/assistant.js';

const html = `<html><head><title>PulseFit</title><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk"></head><body style="background:#0B0F1A">
<nav><a>Home</a><a>Workouts</a></nav><section><h1>Train smarter</h1><button>Start workout</button><img src="x.png"></section><h2>Your stats</h2><p style="color:#7C5CFF">Hi</p></body></html>`;
const page = pageFactsFromHtml('Home', html);
const p = { id: 'p1', name: 'PulseFit', kind: 'ui', device: 'MOBILE', createdAt: Date.now() - 86400000, updatedAt: Date.now() - 60000, archived: false, shared: 0,
  pages: [page, pageFactsFromHtml('Profile')], jobs: [{ type: 'generate', status: 'running', progress: 40, createdAt: Date.now() - 30000 }] };
const a = { plan: 'Pro', credits: 433 };

describe('read-only assistant (built-in answers)', () => {
  it('extracts page facts from HTML', () => {
    expect(page.headings).toEqual(['Train smarter', 'Your stats']);
    expect(page.buttons).toContain('Start workout');
    expect(page.colours).toEqual(['#0b0f1a', '#7c5cff']);
    expect(page.fonts).toEqual(['Space Grotesk']);
    expect(page.images).toBe(1);
  });
  it('answers project questions', () => {
    expect(builtInAnswer('how many pages?', p, a)).toMatch(/2 pages: Home, Profile \(not generated\)/);
    expect(builtInAnswer('which colours are used', p, a)).toMatch(/#7c5cff/);
    expect(builtInAnswer('what fonts?', p, a)).toMatch(/Space Grotesk/);
    expect(builtInAnswer('is it still generating?', p, a)).toMatch(/running \(40%\)/);
    expect(builtInAnswer('tell me about the home page', p, a)).toMatch(/Start workout/);
  });
  it('understands greetings, the project name and summaries', () => {
    expect(builtInAnswer('Hi', p, a)).toMatch(/PulseFit.*an app UI with 2 pages/);
    expect(builtInAnswer('Name of project', p, a)).toMatch(/called “PulseFit”.*Home, Profile/);
    expect(builtInAnswer('what is this project about?', p, a)).toMatch(/an app UI designed for mobile/);
    expect(builtInAnswer('hello', null, a)).toMatch(/433 credits/);
  });
  it('never changes anything and explains costs', () => {
    expect(builtInAnswer('change the header to red', p, a)).toMatch(/only answer questions/);
    expect(builtInAnswer('how many credits do I have', p, a)).toMatch(/433 credits.*free.*5 credits per screen/);
    expect(builtInAnswer('hi', null, a)).toMatch(/433 credits/);
  });
});
