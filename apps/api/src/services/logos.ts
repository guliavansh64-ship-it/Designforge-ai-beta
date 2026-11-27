import sharp from 'sharp';
import { newId } from '../lib/crypto.js';
import { db, C } from '../lib/firebase.js';
import { stitchEngine, NO_QUESTIONS } from './stitch.js';
import { putBlob } from './blobs.js';
import { createVersion, loadProject } from './repo.js';
import type { JobCtx } from './jobs.js';

/**
 * Logo & Brand Studio.
 * Generated via Google Stitch API (authenticated with the user's connected Stitch key).
 * Post-processing (real, deterministic, server-side with sharp):
 *  - transparent PNG: near-white background keyed to alpha
 *  - dark-mode preview: transparent logo composited on a dark surface
 *  - mono-white: alpha silhouette filled white for dark backgrounds
 *  - palette: dominant colours via k-means on downsampled pixels or extracted from design
 * SVG is extracted from the vector output or rendered as clean vector typography.
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
  return [
    `Design a professional ${style.toLowerCase()} logo and visual brand identity for a brand named "${i.brandName}" in the ${i.industry} industry.`,
    i.tagline ? `Brand tagline or idea: ${i.tagline}.` : '',
    i.colorHints ? `Color scheme: ${i.colorHints}.` : 'Use a modern, cohesive palette of at most three colors.',
    style === 'Wordmark'
      ? `The primary logo mark is the brand name "${i.brandName}" designed with custom, clean vector SVG typography.`
      : `Feature a prominent, unique vector logo symbol/mark (as an inline <svg> element) alongside or above the brand name "${i.brandName}".`,
    'Display the primary logo mark centered on a pure white background card.',
    'Below the logo, display the brand color palette swatches with hex color codes, and recommended typography pairings.',
    'Keep the design crisp, flat, vector-styled, centered, with generous whitespace and high contrast.',
    NO_QUESTIONS,
  ].filter(Boolean).join(' ');
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

function extractSvgFromHtml(html: string): string | undefined {
  const matches = html.match(/<svg[\s\S]*?<\/svg>/gi);
  if (!matches || !matches.length) return undefined;
  for (const m of matches) {
    if (m.length > 80 && !m.includes('lucide') && !m.includes('feather')) {
      return m;
    }
  }
  return matches[0];
}

function extractPaletteFromHtml(html: string): string[] {
  const hexMatches = html.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g);
  if (!hexMatches) return [];
  const excluded = new Set(['#fff', '#ffffff', '#000', '#000000', '#fafafa', '#f5f5f5', '#eee', '#eeeeee', '#e5e5e5', '#111', '#111111']);
  const filtered = hexMatches
    .map((h) => h.toLowerCase())
    .filter((h) => !excluded.has(h));
  return [...new Set(filtered)].slice(0, 5);
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

export async function runLogoJob(ctx: JobCtx): Promise<string[]> {
  const input = ctx.job.payload as LogoJobInput;
  const uid = ctx.job.ownerId;
  const project = await loadProject(ctx.job.projectId, uid, 'editor');

  // Ensure Stitch project exists in user's Stitch account
  if (!project.stitchProjectId) {
    await ctx.stage('Creating Stitch project in your account', 8);
    project.stitchProjectId = await ctx.timed(
      stitchEngine.ensureProject(uid, `Designo · ${project.name}`),
      'Create Stitch project'
    );
    await db().collection(C.projects).doc(project.id).update({ stitchProjectId: project.stitchProjectId });
  }

  const styles = input.styles.length ? input.styles : ['Modern'];
  const ids: string[] = [];

  for (let i = 0; i < input.count; i++) {
    await ctx.checkCancelled();
    const style = styles[i % styles.length];
    await ctx.stage(`Generating concept ${i + 1}/${input.count} (${style}) via Google Stitch`, 10 + (i / input.count) * 80);

    const stitchPrompt = buildLogoPrompt(input, style);
    const stitchRes = await ctx.timed(
      stitchEngine.generate(uid, project.stitchProjectId, stitchPrompt, 'MOBILE', 'GEMINI_3_8_FLASH'),
      'Stitch logo generation'
    );

    const type = TYPE_PAIRINGS[style] ?? TYPE_PAIRINGS.Modern;
    const extractedSvg = extractSvgFromHtml(stitchRes.html);

    let png: Buffer | undefined;
    if (extractedSvg) {
      try {
        png = await sharp(Buffer.from(extractedSvg))
          .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .png()
          .toBuffer();
      } catch {
        // Fall back to screenshot or wordmark
      }
    }

    if (!png && stitchRes.image?.data) {
      try {
        png = await sharp(stitchRes.image.data).png().toBuffer();
      } catch {}
    }

    if (!png) {
      const fallbackSvg = wordmarkSvg(input.brandName, '#111827', type.heading.split(',')[0]);
      png = await sharp(Buffer.from(fallbackSvg))
        .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    }

    const transparent = await makeTransparent(png);
    const [dark, mono, imgPalette] = await Promise.all([
      onDark(transparent),
      monoWhite(transparent),
      extractPalette(png),
    ]);

    const htmlColors = extractPaletteFromHtml(stitchRes.html);
    const palette = htmlColors.length >= 2 ? htmlColors : (imgPalette.length ? imgPalette : ['#111827', '#7c5cff']);

    const finalSvg = extractedSvg ?? (style === 'Wordmark' ? wordmarkSvg(input.brandName, palette[0] ?? '#111827', type.heading.split(',')[0]) : undefined);

    const meta = { projectId: project.id, kind: 'logo', concept: i };
    const [a1, a2, a3, a4] = await Promise.all([
      putBlob(uid, png, 'image/png', { ...meta, variant: 'light' }),
      putBlob(uid, transparent, 'image/png', { ...meta, variant: 'transparent' }),
      putBlob(uid, dark, 'image/png', { ...meta, variant: 'dark' }),
      putBlob(uid, mono, 'image/png', { ...meta, variant: 'mono_white' }),
    ]);

    let svgId: string | undefined;
    if (finalSvg) {
      svgId = (await putBlob(uid, Buffer.from(finalSvg), 'image/svg+xml', { ...meta, variant: 'svg' })).id;
    }

    const pageId = newId('pg_');
    const pages = [...project.pages, { id: pageId, name: `${style} concept ${project.pages.length + 1}` }];
    await db().collection(C.projects).doc(project.id).update({ pages });
    project.pages = pages;

    const v = await createVersion({
      projectId: project.id, ownerId: uid, pageId, source: 'logo', prompt: stitchPrompt,
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
