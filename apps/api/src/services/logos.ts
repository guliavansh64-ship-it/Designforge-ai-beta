import sharp from 'sharp';
import { newId } from '../lib/crypto.js';
import { db, C } from '../lib/firebase.js';
import { putBlob } from './blobs.js';
import { createVersion, loadProject } from './repo.js';
import { AppError } from '../lib/errors.js';
import type { JobCtx } from './jobs.js';
import type { Project } from '@designforge/shared';

/**
 * Logo & Brand Studio.
 * Logos are DESIGNED BY GOOGLE STITCH (user's own Stitch key): Stitch renders a screen that contains only the
 * logo on a white canvas; we take Stitch's own rendering (screenshot), trim it to the logo and square it.
 * Gemini is NOT used for logos.
 * Post-processing (all real, deterministic, server-side with sharp):
 *  - transparent PNG: near-white background keyed to alpha (best for flat logos on white)
 *  - dark-mode preview: transparent logo composited on a dark surface
 *  - mono-white: alpha silhouette filled white for dark backgrounds
 *  - palette: dominant colours via k-means on downsampled pixels
 * SVG is offered ONLY for wordmarks (true vector text). Raster AI logos are PNG-only.
 */

export interface LogoJobInput {
  brandName: string;
  industry: string;
  styles: string[];
  colorHints?: string;
  tagline?: string;
  count: number;
}

const TYPE_PAIRINGS: Record<string, { heading: string; body: string; why: string }> = {
  Minimalist: { heading: 'Inter', body: 'Inter', why: 'Neutral geometric sans keeps focus on the mark.' },
  Modern: { heading: 'Space Grotesk', body: 'Inter', why: 'Distinctive grotesk headlines with highly legible body text.' },
  Wordmark: { heading: 'Sora', body: 'DM Sans', why: 'Wide, confident letterforms suit name-led identities.' },
  Icon: { heading: 'Manrope', body: 'Manrope', why: 'Rounded geometry echoes icon shapes.' },
  Emblem: { heading: 'Playfair Display', body: 'Source Sans 3', why: 'Classic serif conveys heritage; clean sans for UI.' },
  Abstract: { heading: 'Clash Display, Sora', body: 'Inter', why: 'Expressive display face balanced by a neutral workhorse.' },
};

export function buildLogoPrompt(i: LogoJobInput, style: string) {
  const mark = style === 'Wordmark'
    ? `The logo is ONLY the brand name "${i.brandName}" set in distinctive, custom-looking, highly legible lettering (one line).`
    : style === 'Icon'
      ? 'The logo is ONLY a simple, memorable symbol (no text at all), built from bold inline SVG shapes.'
      : `The logo is a simple, memorable symbol (bold inline SVG shapes) placed ${style === 'Emblem' ? 'inside a badge / emblem shape with' : 'next to'} the brand name "${i.brandName}".`;
  return [
    `Design a ${style.toLowerCase()} LOGO for a brand named "${i.brandName}" in the ${i.industry} industry.`,
    i.tagline ? `Brand idea: ${i.tagline}.` : '',
    mark,
    i.colorHints ? `Colour direction: ${i.colorHints}.` : 'Use a restrained, premium palette of at most three colours.',
    'LAYOUT (very important): the whole screen is a plain pure white (#FFFFFF) canvas. The logo is the ONLY thing on it — large, perfectly centred, with generous empty white space around it.',
    'Do NOT add any navigation bar, header, footer, buttons, menus, cards, borders, frames, backgrounds, mockups, photos, captions, taglines, colour swatches, descriptions or any other UI or text. No shadows, flat vector look, crisp edges.',
    'Generate exactly one screen now. Do not ask clarifying questions or propose a plan first: make sensible assumptions for anything unspecified.',
  ].filter(Boolean).join('\n');
}

/** Crops Stitch's rendering down to the logo itself and centres it on a square white canvas. */
export async function cropToLogo(shot: Buffer, size = 1024): Promise<Buffer> {
  const flat = await sharp(shot).flatten({ background: '#ffffff' }).png().toBuffer();
  const st = await sharp(flat).stats();
  if (st.channels.slice(0, 3).every((c) => c.min >= 238)) throw new AppError(502, 'STITCH_EMPTY_RESULT', 'Stitch returned an empty canvas for this logo. Please try again.');
  let trimmed: Buffer; let info: { width: number; height: number };
  try {
    const r = await sharp(flat).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer({ resolveWithObject: true });
    trimmed = r.data; info = r.info;
  } catch { throw new AppError(502, 'STITCH_EMPTY_RESULT', 'Stitch returned an empty canvas for this logo. Please try again.'); }
  if (info.width < 24 || info.height < 24) throw new AppError(502, 'STITCH_EMPTY_RESULT', 'Stitch returned an empty canvas for this logo. Please try again.');
  const inner = Math.round(size * 0.78);
  const fitted = await sharp(trimmed).resize(inner, inner, { fit: 'inside', withoutEnlargement: false, background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
  return sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .composite([{ input: fitted.data, left: Math.round((size - fitted.info.width) / 2), top: Math.round((size - fitted.info.height) / 2) }])
    .png().toBuffer();
}

/** Stitch operations injected by the job runner (keeps logos.ts free of a runtime import cycle with jobs.ts). */
export interface LogoStitch {
  ensureProject(project: Project): Promise<string>;
  generate(stitchProjectId: string, prompt: string, label: string): Promise<{ html: string; image?: { data: Buffer; mime: string } }>;
}

export async function makeTransparent(png: Buffer, threshold = 238): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const min = Math.min(r, g, b);
    if (min >= threshold) data[i + 3] = 0;
    else if (min > threshold - 30) data[i + 3] = Math.round(((threshold - min) / 30) * 255); // soft edge
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export async function monoWhite(transparentPng: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(transparentPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export async function onDark(transparentPng: Buffer, bg = '#0B0B12'): Promise<Buffer> {
  const meta = await sharp(transparentPng).metadata();
  return sharp({ create: { width: meta.width!, height: meta.height!, channels: 4, background: bg } })
    .composite([{ input: transparentPng }]).png().toBuffer();
}

export async function extractPalette(png: Buffer, k = 5): Promise<string[]> {
  const { data } = await sharp(png).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: number[][] = [];
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (Math.min(r, g, b) > 235) continue; // skip white background
    px.push([r, g, b]);
  }
  if (!px.length) return ['#111111'];
  let centers = Array.from({ length: Math.min(k, px.length) }, (_, i) => px[Math.floor((i * px.length) / Math.min(k, px.length))]);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; best = ci; } });
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
    }
    centers = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[i]));
  }
  const hex = centers.map((c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
  return [...new Set(hex)];
}

export function wordmarkSvg(name: string, color: string, font: string) {
  const esc = name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const w = Math.max(240, name.length * 38 + 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="120" viewBox="0 0 ${w} 120" role="img" aria-label="${esc}">
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="${font}, Inter, Arial, sans-serif" font-size="64" font-weight="700" letter-spacing="-1" fill="${color}">${esc}</text>
</svg>`;
}

function brandPreviewHtml(name: string, assets: { light: string; dark: string; transparent: string }, palette: string[], type: { heading: string; body: string; why: string }, style: string) {
  const sw = palette.map((c) => `<div style="flex:1;min-width:90px"><div style="height:72px;border-radius:12px;background:${c};border:1px solid #0001"></div><code style="font-size:13px">${c}</code></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name} — ${style} logo</title>
<style>body{margin:0;font-family:system-ui,sans-serif;color:#111;background:#fafafa}main{max-width:960px;margin:0 auto;padding:32px}h1{font-size:28px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 12px;color:#444}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.c{border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;background:#fff}.c img{width:100%;display:block}.c p{margin:0;padding:10px 12px;font-size:13px;color:#555}.row{display:flex;gap:12px;flex-wrap:wrap}</style></head>
<body><main><h1>${name}</h1><p>${style} concept</p>
<h2>Logo versions</h2><div class="g"><div class="c"><img src="${assets.light}" alt="${name} logo on light"><p>Light</p></div><div class="c"><img src="${assets.dark}" alt="${name} logo on dark"><p>Dark</p></div><div class="c" style="background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/20px 20px"><img src="${assets.transparent}" alt="${name} transparent logo"><p style="background:#fff">Transparent PNG</p></div></div>
<h2>Palette (extracted from the logo)</h2><div class="row">${sw}</div>
<h2>Typography recommendation</h2><p><strong>${type.heading}</strong> for headings, <strong>${type.body}</strong> for body. ${type.why}</p></main></body></html>`;
}

export async function runLogoJob(ctx: JobCtx, stitch: LogoStitch): Promise<string[]> {
  const input = ctx.job.payload as LogoJobInput;
  const uid = ctx.job.ownerId;
  const project = await loadProject(ctx.job.projectId, uid, 'editor');
  const styles = input.styles.length ? input.styles : ['Modern'];
  const ids: string[] = [];
  const sid = await stitch.ensureProject(project as Project);
  const errors: string[] = [];
  for (let i = 0; i < input.count; i++) {
    await ctx.checkCancelled();
    const style = styles[i % styles.length];
    await ctx.stage(`Designing concept ${i + 1}/${input.count} (${style}) with Google Stitch`, 10 + (i / input.count) * 80);
    let png: Buffer;
    try {
      const r = await stitch.generate(sid, buildLogoPrompt(input, style), `${style} logo`);
      if (!r.image?.data?.length) throw new AppError(502, 'STITCH_EMPTY_RESULT', 'Stitch did not return a rendering for this logo. Please try again.');
      png = await cropToLogo(r.image.data);
    } catch (e) {
      // Keep finished concepts; only fail the whole job when nothing could be made.
      if (i === input.count - 1 && !ids.length) throw e;
      if (e instanceof AppError && [401, 403, 412, 429].includes(e.status)) { if (!ids.length) throw e; break; }
      errors.push((e as Error).message); continue;
    }
    const transparent = await makeTransparent(png);
    const [dark, mono, palette] = await Promise.all([onDark(transparent), monoWhite(transparent), extractPalette(png)]);
    const meta = { projectId: project.id, kind: 'logo', concept: i };
    const [a1, a2, a3, a4] = await Promise.all([
      putBlob(uid, png, 'image/png', { ...meta, variant: 'light' }),
      putBlob(uid, transparent, 'image/png', { ...meta, variant: 'transparent' }),
      putBlob(uid, dark, 'image/png', { ...meta, variant: 'dark' }),
      putBlob(uid, mono, 'image/png', { ...meta, variant: 'mono_white' }),
    ]);
    const type = TYPE_PAIRINGS[style] ?? TYPE_PAIRINGS.Modern;
    const svg = style === 'Wordmark' ? wordmarkSvg(input.brandName, palette[0] ?? '#111', type.heading.split(',')[0]) : undefined;
    let svgId: string | undefined;
    if (svg) svgId = (await putBlob(uid, Buffer.from(svg), 'image/svg+xml', { ...meta, variant: 'svg' })).id;

    const pageId = newId('pg_');
    const pages = [...project.pages, { id: pageId, name: `${style} concept ${project.pages.length + 1}` }];
    await db().collection(C.projects).doc(project.id).update({ pages });
    project.pages = pages;
    const v = await createVersion({
      projectId: project.id, ownerId: uid, pageId, source: 'logo', prompt: buildLogoPrompt(input, style),
      html: brandPreviewHtml(input.brandName, { light: a1.url, dark: a3.url, transparent: a2.url }, palette, type, style),
      imageUrl: a1.url,
    });
    await db().collection(C.versions).doc(v.id).update({
      logo: { style, palette, typography: type, assets: { light: a1.id, transparent: a2.id, dark: a3.id, monoWhite: a4.id, svg: svgId ?? null } },
    });
    ids.push(v.id);
  }
  return ids;
}
