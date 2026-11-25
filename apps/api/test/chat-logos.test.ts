import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { classify } from '../src/routes/chat.js';
import { buildLogoPrompt, extractPalette, makeTransparent, monoWhite, wordmarkSvg } from '../src/services/logos.js';

describe('chat intent routing', () => {
  it.each([
    ['Generate another variation', 'variants'],
    ['Convert this page into a React component', 'react'],
    ['Create a pricing page', 'new_page'],
    ['Add a dashboard screen', 'new_page'],
    ['Improve the design quality', 'improve'],
    ['Redesign the hero section', 'edit'],
    ['Change the theme to dark', 'edit'],
  ])('%s → %s', (msg, intent) => expect(classify(msg).intent).toBe(intent));
  it('targets sections', () => {
    expect(classify('Redesign the hero section')).toMatchObject({ section: 'hero' });
    expect(classify('Improve the navbar spacing')).toMatchObject({ section: 'navigation' });
  });
});

describe('logo post-processing', () => {
  const makeLogo = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
    .composite([{ input: { create: { width: 32, height: 32, channels: 3, background: '#4f46e5' } }, left: 16, top: 16 }]).png().toBuffer();

  it('keys white background to transparent while keeping the mark opaque', async () => {
    const t = await makeTransparent(await makeLogo());
    const { data } = await sharp(t).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // corner pixel alpha
    const center = (32 * 64 + 32) * 4;
    expect(data[center + 3]).toBe(255);
  });
  it('mono-white keeps alpha, fills white', async () => {
    const m = await monoWhite(await makeTransparent(await makeLogo()));
    const { data } = await sharp(m).raw().toBuffer({ resolveWithObject: true });
    const c = (32 * 64 + 32) * 4;
    expect([data[c], data[c + 1], data[c + 2], data[c + 3]]).toEqual([255, 255, 255, 255]);
  });
  it('extracts the brand colour', async () => {
    const pal = await extractPalette(await makeLogo());
    expect(pal[0]).toBe('#4f46e5');
  });
  it('wordmark SVG is real vector text and escaped', () => {
    const svg = wordmarkSvg('A&B <Co>', '#111', 'Sora');
    expect(svg).toContain('<svg');
    expect(svg).toContain('A&amp;B &lt;Co&gt;');
  });
  it('prompt specifies white background and style', () => {
    expect(buildLogoPrompt({ brandName: 'Kora', industry: 'homeware', styles: ['Icon'], count: 1 }, 'Icon')).toMatch(/icon.*white background/is);
  });
});
