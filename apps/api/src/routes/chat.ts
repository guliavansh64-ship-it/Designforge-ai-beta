import { normalizeStitchModel } from '@designforge/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parse } from 'node-html-parser';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { generationLimiter } from '../middleware/rateLimit.js';
import { getVersion, loadProject } from '../services/repo.js';
import { enqueue } from '../services/jobs.js';
import { getEntitlements } from '../services/plans.js';
import { listConnectionStatus } from '../services/connections.js';
import { htmlNodeToJsx } from '../services/exporter.js';
import { newId } from '../lib/crypto.js';
import { Errors } from '../lib/errors.js';

/**
 * Project-aware chat assistant. Deterministic intent routing (transparent and cheap):
 *   variation → Stitch variants | "convert … react" → local HTML→JSX | "create/add … page" → new page
 *   "improve/audit/accessibility" → improvement engine | anything else → Stitch edit of the active page
 *   (with section targeting when a known section is named). Image attachments are imported into
 *   the user's Stitch project via the official SDK upload and then refined with the message.
 */
export const chatRouter = Router();

const SECTIONS = ['hero', 'header', 'navigation', 'navbar', 'footer', 'pricing', 'testimonials', 'features', 'faq', 'contact', 'sidebar', 'cta', 'gallery', 'about', 'team', 'blog'];

export function classify(message: string) {
  const m = message.toLowerCase();
  if (/\b(variation|variant|alternative|another (version|option|design))\b/.test(m)) return { intent: 'variants' as const };
  if (/\breact\b/.test(m) && /\b(convert|component|export|turn)\b/.test(m)) return { intent: 'react' as const };
  const page = /\b(create|add|make|generate|build)\s+(?:a|an|the)?\s*(?:new\s+)?([a-z][a-z\s-]{1,30}?)\s+(page|screen)\b/.exec(m);
  if (page) return { intent: 'new_page' as const, pageName: page[2].trim().replace(/\b\w/g, (c) => c.toUpperCase()) };
  if (/\b(improve (the )?(design|quality|overall)|audit|accessib|fix (the )?issues)\b/.test(m)) return { intent: 'improve' as const };
  const section = SECTIONS.find((s) => new RegExp(`\\b${s}\\b`).test(m));
  return { intent: 'edit' as const, section: section === 'navbar' ? 'navigation' : section };
}

chatRouter.get('/projects/:id/chat', ah(async (req, res) => {
  const p = await loadProject(req.params.id, req.user!.uid, 'viewer');
  const s = await db().collection(C.chat).where('projectId', '==', p.id).where('ownerId', '==', p.ownerId).orderBy('createdAt', 'asc').limitToLast(100).get();
  res.json({ messages: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

chatRouter.post('/projects/:id/chat', generationLimiter, validate(z.object({
  message: z.string().trim().min(2).max(2000), pageId: z.string(),
  deviceType: z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC']).optional(),
  model: z.string().max(40).optional().transform(normalizeStitchModel),
  imageBase64: z.string().max(7_000_000).optional(), imageExt: z.enum(['.png', '.jpg', '.jpeg', '.webp']).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
})), ah(async (req, res) => {
  const uid = req.user!.uid;
  const p = await loadProject(req.params.id, uid, 'owner');
  const { plan } = await getEntitlements(uid);
  const deviceType = req.body.deviceType ?? p.deviceType;
  const page = p.pages.find((x) => x.id === req.body.pageId);
  if (!page) throw Errors.notFound('Page');
  const chat = db().collection(C.chat);
  await chat.add({ ownerId: uid, projectId: p.id, pageId: page.id, role: 'user', text: req.body.message, hasImage: !!req.body.imageBase64, createdAt: Date.now() });
  const reply = async (text: string, extra: Record<string, unknown> = {}) => {
    const doc = { ownerId: uid, projectId: p.id, pageId: page.id, role: 'assistant', text, ...extra, createdAt: Date.now() };
    const ref = await chat.add(doc);
    return { id: ref.id, ...doc };
  };
  const stitch = (await listConnectionStatus(uid)).find((c) => c.provider === 'stitch')!;
  const c = classify(req.body.message);

  if (c.intent === 'react') {
    if (!page.currentVersionId) throw Errors.validation('Generate this page first.');
    const v = await getVersion(page.currentVersionId, uid);
    const body = parse(v.html, { blockTextElements: { script: true, style: true } }).querySelector('body');
    const name = page.name.replace(/[^a-zA-Z0-9]/g, '') || 'Page';
    const inner = (body?.childNodes ?? []).map((n) => htmlNodeToJsx(n, 3)).filter(Boolean).join('\n');
    const typeImport = inner.includes('as CSSProperties') ? "import type { CSSProperties } from 'react';\n\n" : '';
    const code = `${typeImport}export default function ${name[0].toUpperCase() + name.slice(1)}() {\n  return (\n    <>\n${inner}\n    </>\n  );\n}\n`;
    return res.json({ message: await reply(`Here is "${page.name}" as a React + TypeScript component (Tailwind classes preserved). For a full runnable project use Export → React.`, { code, codeLang: 'tsx' }) });
  }
  if (!stitch.connected) throw Errors.stitchNotConnected();

  if (req.body.imageBase64 && req.body.imageExt) {
    const newPageId = newId('pg_');
    await db().collection(C.projects).doc(p.id).update({ pages: [...p.pages, { id: newPageId, name: 'From reference' }] });
    const job = await enqueue({ ownerId: uid, projectId: p.id, type: 'improve', prompt: req.body.message, op: 'improve_iteration', idempotencyKey: req.body.idempotencyKey, priority: plan.features.includes('priority_queue'), deviceType, model: req.body.model,
      payload: { pageId: newPageId, instructions: req.body.message, autoIterate: false, maxIterations: 1, targetScore: 90, deviceType, model: req.body.model, importAssetBase64: req.body.imageBase64, importExt: req.body.imageExt } });
    return res.status(202).json({ job, message: await reply('Importing your reference image into your Stitch project and applying your instructions on a new page "From reference".', { jobId: job.id }) });
  }

  let job;
  if (c.intent === 'variants') {
    if (!plan.features.includes('variants')) throw Errors.feature('design variations');
    job = await enqueue({ ownerId: uid, projectId: p.id, type: 'variants', prompt: req.body.message, op: 'variants', idempotencyKey: req.body.idempotencyKey, priority: plan.features.includes('priority_queue'), deviceType, model: req.body.model,
      payload: { prompt: req.body.message, pageId: page.id, count: 3, creativeRange: 'EXPLORE', deviceType, model: req.body.model } });
  } else if (c.intent === 'new_page') {
    job = await enqueue({ ownerId: uid, projectId: p.id, type: 'generate', prompt: req.body.message, op: 'generate_flash', idempotencyKey: req.body.idempotencyKey, priority: plan.features.includes('priority_queue'), deviceType, model: req.body.model,
      payload: { prompt: `${req.body.message}. Match the visual style, colours and typography of the existing "${page.name}" page in this project.`, deviceType, model: req.body.model, newPageName: c.pageName } });
  } else if (c.intent === 'improve') {
    job = await enqueue({ ownerId: uid, projectId: p.id, type: 'improve', prompt: req.body.message, op: 'improve_iteration', idempotencyKey: req.body.idempotencyKey, priority: plan.features.includes('priority_queue'), deviceType, model: req.body.model,
      payload: { pageId: page.id, instructions: req.body.message, autoIterate: false, maxIterations: 1, targetScore: 90, deviceType, model: req.body.model } });
  } else {
    job = await enqueue({ ownerId: uid, projectId: p.id, type: 'chat', prompt: req.body.message, op: 'chat_edit', idempotencyKey: req.body.idempotencyKey, priority: plan.features.includes('priority_queue'), deviceType, model: req.body.model,
      payload: { prompt: req.body.message, pageId: page.id, section: c.section, deviceType, model: req.body.model } });
  }
  const labels = { variants: 'Generating 3 variations of this page', new_page: `Creating a new "${(c as any).pageName}" page in the same style`, improve: 'Running the improvement engine on this page', edit: c.intent === 'edit' && c.section ? `Updating the ${c.section} section` : 'Applying your change to this page' } as const;
  res.status(202).json({ job, message: await reply(`${labels[c.intent as keyof typeof labels]}…`, { jobId: job.id, intent: c.intent }) });
}));
