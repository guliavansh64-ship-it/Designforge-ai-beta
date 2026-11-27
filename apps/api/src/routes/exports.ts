import { Router } from 'express';
import { z } from 'zod';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { getVersion, loadProject } from '../services/repo.js';
import { assertFeature } from '../services/plans.js';
import { buildHtmlExport, buildReactExport, zipFiles } from '../services/exporter.js';
import * as credits from '../services/credits.js';
import { getBlob } from '../services/blobs.js';
import { AppError, Errors } from '../lib/errors.js';
import { track } from '../services/notify.js';

export const exportsRouter = Router();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

/**
 * Builds and validates the export, THEN charges credits (no charge for failed builds).
 * Response: application/zip with X-Export-Report header (JSON, base64) for warnings.
 */
exportsRouter.post('/projects/:id/export', validate(z.object({
  format: z.enum(['html', 'react']), pageIds: z.array(z.string()).max(30).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const p = await loadProject(req.params.id, uid, 'viewer');
  await assertFeature(uid, req.body.format === 'react' ? 'react_export' : 'html_export');
  const pages = [];
  for (const pg of p.pages) {
    if (req.body.pageIds && !req.body.pageIds.includes(pg.id)) continue;
    if (!pg.currentVersionId) continue;
    const v = await getVersion(pg.currentVersionId, uid);
    if (v.html) pages.push({ name: pg.name, html: v.html });
  }
  if (!pages.length) throw Errors.validation('No generated pages to export yet.');
  const build = req.body.format === 'react' ? await buildReactExport(p.name, pages) : await buildHtmlExport(p.name, pages);
  if (build.report.errors.length) {
    throw new AppError(422, 'EXPORT_VALIDATION_FAILED', `Export validation failed:\n${build.report.errors.slice(0, 10).join('\n')}`);
  }
  const r = await credits.reserve(uid, req.body.format === 'react' ? 'react_export' : 'html_export', `export_${req.body.idempotencyKey}`);
  try {
    const zip = await zipFiles(build.files, `${slug(p.name)}-${req.body.format}`);
    await credits.commit(r.txnId);
    await db().collection(C.generations).add({ ownerId: uid, projectId: p.id, type: `export_${req.body.format}`, status: 'succeeded', files: build.report.files, createdAt: Date.now() });
    await track(`export_${req.body.format}`);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${slug(p.name)}-${req.body.format}.zip"`);
    res.setHeader('x-export-report', Buffer.from(JSON.stringify(build.report)).toString('base64'));
    res.setHeader('access-control-expose-headers', 'x-export-report, content-disposition');
    res.send(zip);
  } catch (e) {
    await credits.refund(r.txnId, 'Export packaging failed');
    throw e;
  }
}));

/**
 * Single-version downloads (free — the user already owns and sees this content):
 *   ?format=html → the page as one self-contained .html file
 *   ?format=png  → the Stitch screenshot of the screen
 */
exportsRouter.get('/versions/:vid/download', validate(z.object({ format: z.enum(['html', 'png']).default('html') }), 'query'), ah(async (req, res) => {
  const uid = req.user!.uid;
  const v: any = await getVersion(req.params.vid, uid);
  const p = await loadProject(v.projectId, uid, 'viewer');
  const page = p.pages.find((x) => x.id === v.pageId);
  const base = `${slug(p.name)}-${slug(page?.name ?? 'screen')}`;
  res.setHeader('access-control-expose-headers', 'content-disposition');
  if (req.query.format === 'png') {
    const url: string | undefined = v.imageUrl;
    if (!url) throw Errors.validation('This version has no screenshot. Regenerate it or download the HTML instead.');
    let data: Buffer; let mime = 'image/png';
    const m = /^\/api\/assets\/([A-Za-z0-9_-]+)/.exec(url);
    if (m) {
      const b = await getBlob(m[1], v.ownerId);
      if ('data' in b) { data = b.data; mime = b.mime; }
      else { const r = await fetch(b.redirect); data = Buffer.from(await r.arrayBuffer()); mime = r.headers.get('content-type') ?? mime; }
    } else if (/^https:\/\//.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new AppError(502, 'DOWNLOAD_FAILED', 'Could not fetch the screenshot.');
      data = Buffer.from(await r.arrayBuffer()); mime = r.headers.get('content-type') ?? mime;
    } else throw Errors.validation('Screenshot unavailable.');
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
    res.setHeader('content-type', mime);
    res.setHeader('content-disposition', `attachment; filename="${base}.${ext}"`);
    res.send(data);
    return;
  }
  if (!v.html) throw Errors.validation('This version has no HTML.');
  await track('download_html_page');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${base}.html"`);
  res.send(v.html);
}));

/** Brand kit ZIP for a logo concept version. */
exportsRouter.get('/versions/:vid/brand-kit', ah(async (req, res) => {
  const uid = req.user!.uid;
  const v: any = await getVersion(req.params.vid, uid);
  if (!v.logo) throw Errors.validation('Not a logo concept');
  const files: Record<string, string | Buffer> = {};
  for (const [variant, id] of Object.entries(v.logo.assets as Record<string, string | null>)) {
    if (!id) continue;
    const b = await getBlob(id, v.ownerId);
    if ('data' in b) files[`logo/${variant}.${b.mime.includes('svg') ? 'svg' : 'png'}`] = b.data;
    else { const r = await fetch(b.redirect); files[`logo/${variant}.png`] = Buffer.from(await r.arrayBuffer()); }
  }
  files['palette.json'] = JSON.stringify({ colors: v.logo.palette }, null, 2);
  files['colors.css'] = `:root {\n${v.logo.palette.map((c: string, i: number) => `  --brand-${i + 1}: ${c};`).join('\n')}\n}\n`;
  files['typography.md'] = `# Typography\n\n- Headings: **${v.logo.typography.heading}**\n- Body: **${v.logo.typography.body}**\n\n${v.logo.typography.why}\n`;
  files['brand-guide.html'] = v.html.replace(/src="\/api\/assets\/[^"]+"/g, (m: string) => m); // preview uses API URLs; logo files are in /logo
  files['README.md'] = `# Brand kit\n\nGenerated with Designo (logo designed by Google Stitch with your own Stitch key).\n\n- logo/light.png — on white\n- logo/transparent.png — background removed (best for flat logos)\n- logo/dark.png — preview on dark\n- logo/mono_white.png — single-colour white for dark backgrounds\n${v.logo.assets.svg ? '- logo/svg.svg — vector wordmark\n' : '- SVG: not available for raster logos (only wordmarks are true vectors)\n'}`;
  const zip = await zipFiles(files, 'brand-kit');
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-disposition', 'attachment; filename="brand-kit.zip"');
  res.send(zip);
}));
