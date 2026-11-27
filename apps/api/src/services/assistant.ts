import { parse } from 'node-html-parser';
import { db, C } from '../lib/firebase.js';
import { safeQuery } from '../lib/safeQuery.js';
import { logger } from '../lib/logger.js';
import { gemini } from './gemini.js';
import { listConnectionStatus } from './connections.js';
import { getVersion, loadProject } from './repo.js';
import { getEntitlements } from './plans.js';
import { getBalance } from './credits.js';

/**
 * Free, READ-ONLY project assistant.
 *  - It never enqueues jobs, never edits pages and never spends credits.
 *  - It answers questions about the user's project (pages, content, colours, fonts, status, exports)
 *    and about the app (credits, plans, how-to).
 *  - If the user connected THEIR OWN Gemini key, Gemini writes the answer. Otherwise, or if Gemini
 *    fails, a built-in answerer replies from the same project facts, so it always responds.
 *  - Hidden enhanced prompts are never included in the context (only the user's own words).
 */

export interface PageFacts { name: string; generated: boolean; title?: string; headings: string[]; buttons: string[]; links: string[]; colours: string[]; fonts: string[]; images: number; sections: number; textSample: string }
export interface ProjectFacts {
  id: string; name: string; kind: string; device: string; createdAt: number; updatedAt: number; archived: boolean; shared: number;
  pages: PageFacts[]; jobs: { type: string; status: string; progress?: number; createdAt: number; error?: string }[];
}
export interface AccountFacts { plan: string; credits: number; subscriptionStatus?: string; renewsOrExpiresAt?: number }

const uniq = (a: string[], n: number) => [...new Set(a.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && s.length <= 80))].slice(0, n);

export function pageFactsFromHtml(name: string, html?: string): PageFacts {
  if (!html) return { name, generated: false, headings: [], buttons: [], links: [], colours: [], fonts: [], images: 0, sections: 0, textSample: '' };
  const root = parse(html, { blockTextElements: { script: true, style: true } });
  const txt = (sel: string, n: number) => uniq(root.querySelectorAll(sel).map((e) => e.text), n);
  const colours = uniq((html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase()), 8);
  const fonts = uniq([...html.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1].replace(/\+/g, ' ')), 4);
  const body = root.querySelector('body');
  return {
    name, generated: true,
    title: root.querySelector('title')?.text.trim() || undefined,
    headings: txt('h1, h2, h3', 14),
    buttons: txt('button, a.btn, [role=button]', 12),
    links: txt('nav a, header a', 10),
    colours, fonts,
    images: root.querySelectorAll('img').length,
    sections: root.querySelectorAll('section, header, footer, nav, main > div').length,
    textSample: (body?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
  };
}

export async function collectProjectFacts(uid: string, projectId: string): Promise<ProjectFacts> {
  const p = await loadProject(projectId, uid, 'viewer');
  const pages = await Promise.all(p.pages.slice(0, 8).map(async (pg) => {
    if (!pg.currentVersionId) return pageFactsFromHtml(pg.name);
    try { return pageFactsFromHtml(pg.name, (await getVersion(pg.currentVersionId, uid)).html); } catch { return pageFactsFromHtml(pg.name); }
  }));
  const jobs = await safeQuery(db().collection(C.jobs), { where: [['projectId', '==', p.id], ['ownerId', '==', p.ownerId]], orderBy: ['createdAt', 'desc'], limit: 5 })
    .then((docs) => docs.map((d) => { const j = d.data(); return { type: String(j.type), status: String(j.status), progress: j.progress, createdAt: j.createdAt, error: j.error?.message ?? (typeof j.error === 'string' ? j.error : undefined) }; }))
    .catch(() => []);
  return { id: p.id, name: p.name, kind: p.kind, device: p.deviceType, createdAt: p.createdAt, updatedAt: p.updatedAt, archived: !!p.archived, shared: p.sharedUids?.length ?? 0, pages, jobs };
}

export async function collectAccountFacts(uid: string): Promise<AccountFacts> {
  const [ent, bal] = await Promise.all([getEntitlements(uid), getBalance(uid)]);
  const s: any = ent.sub;
  return { plan: ent.plan.name, credits: Number(bal ?? 0), subscriptionStatus: s?.status, renewsOrExpiresAt: s?.currentPeriodEnd };
}

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const list = (a: string[]) => (a.length ? a.map((x) => `“${x}”`).join(', ') : 'none found');

/** Built-in answerer: deterministic, uses only the facts. Always returns something useful. */
export function builtInAnswer(q: string, p: ProjectFacts | null, a: AccountFacts): string {
  const m = q.toLowerCase();
  const has = (...w: string[]) => w.some((x) => m.includes(x));
  if (has('credit', 'balance')) return `You have ${a.credits} credits on the ${a.plan} plan. Asking me questions is free. Creating a design costs 5 credits per screen, an edit 2 credits, HTML ZIP export 1, React export 2. PNG/HTML downloads are free.`;
  if (has('plan', 'subscription', 'renew', 'expire')) return `You are on the ${a.plan} plan${a.subscriptionStatus ? ` (status: ${a.subscriptionStatus})` : ''}.${a.renewsOrExpiresAt ? ` Your current period ends on ${new Date(a.renewsOrExpiresAt).toDateString()}.` : ''} Plans do not auto-renew — renew each month from Settings → Plans & credits.`;
  if (has('change', 'edit', 'modify', 'update', 'make it', 'redesign')) return 'I can only answer questions — I never change your project. To change a design, open the project, pick the page and use the “AI edit” tab, or create a new design in the Studio.';
  if (has('export', 'download', 'code', 'react', 'zip', 'html', 'figma')) return 'Open the project → a page → Download. PNG and HTML are free, HTML ZIP costs 1 credit and a runnable React project costs 2 credits.';
  if (!p && /\b(hi|hello|hey|namaste)\b/.test(m)) return `Hi! 👋 I'm your free Designo assistant. You have ${a.credits} credits on the ${a.plan} plan. Pick a project above and ask me anything about it.`;
  if (!p) return `I can answer questions about your projects, credits and plan. You have ${a.credits} credits (${a.plan}). Pick a project above to ask about its pages, colours, fonts, buttons or status.`;
  const gen = p.pages.filter((x) => x.generated);
  const kindName = p.kind === 'website' ? 'a website' : 'an app UI';
  const words = m.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const greet = words.length <= 3 && words.some((w) => ['hi', 'hello', 'hey', 'hii', 'namaste', 'yo', 'sup'].includes(w));
  if (greet) return `Hi! 👋 I'm your free Designo assistant. You're looking at “${p.name}” — ${kindName} with ${p.pages.length} page${p.pages.length === 1 ? '' : 's'}. Ask me its pages, colours, fonts, buttons, status or what you can export.`;
  if (has('name', 'called', 'title of')) return `This project is called “${p.name}”.${p.pages.length ? ` Its page${p.pages.length === 1 ? ' is' : 's are'}: ${p.pages.map((x) => x.name).join(', ')}.` : ''}`;
  if (has('what is this', 'what is it', 'about this', 'describe', 'summary', 'summar', 'overview', 'type of', 'kind of')) return `“${p.name}” is ${kindName} designed for ${p.device.toLowerCase()}, with ${p.pages.length} page${p.pages.length === 1 ? '' : 's'} (${p.pages.map((x) => x.name).join(', ')}). ${gen[0]?.headings.length ? `Main headings: ${list(gen[0].headings.slice(0, 4))}.` : ''}`.trim();
  if (has('help', 'what can you', 'what do you')) return `I answer questions for free — I never change anything. Try: “how many pages?”, “which colours and fonts?”, “what buttons are on ${p.pages[0]?.name ?? 'the first page'}?”, “is it still generating?”, “how many credits do I have?”.`;
  const named = p.pages.find((x) => m.includes(x.name.toLowerCase()));
  if (named) {
    if (!named.generated) return `“${named.name}” has not been generated yet.`;
    return `“${named.name}”: headings ${list(named.headings.slice(0, 6))}; buttons ${list(named.buttons.slice(0, 6))}; ${named.images} images; colours ${named.colours.slice(0, 5).join(', ') || 'n/a'}${named.fonts.length ? `; fonts ${named.fonts.join(', ')}` : ''}.`;
  }
  if (has('status', 'progress', 'generating', 'ready', 'done', 'fail', 'stuck')) {
    const j = p.jobs[0];
    if (!j) return `“${p.name}” has ${gen.length} of ${p.pages.length} pages generated and nothing is running now.`;
    return `Latest job: ${j.type} — ${j.status}${j.progress != null && j.status !== 'completed' ? ` (${j.progress}%)` : ''}, started ${ago(j.createdAt)}.${j.error ? ` Reason: ${j.error}` : ''} ${gen.length} of ${p.pages.length} pages are ready.`;
  }
  if (has('colour', 'color', 'palette') && has('font', 'typography')) return `Colours: ${uniq(gen.flatMap((x) => x.colours), 8).join(', ') || 'not detected'}. Fonts: ${uniq(gen.flatMap((x) => x.fonts), 6).join(', ') || 'system fonts / not detected'}.`;
  if (has('colour', 'color', 'palette')) return `Colours used in “${p.name}”: ${uniq(gen.flatMap((x) => x.colours), 10).join(', ') || 'not detected'}.`;
  if (has('font', 'typography', 'typeface')) return `Fonts used: ${uniq(gen.flatMap((x) => x.fonts), 6).join(', ') || 'system fonts / not detected'}.`;
  if (has('button', 'cta', 'action')) return `Buttons: ${list(uniq(gen.flatMap((x) => x.buttons), 12))}.`;
  if (has('heading', 'title', 'section', 'content', 'text', 'what is on', "what's on")) return gen.map((x) => `• ${x.name}: ${list(x.headings.slice(0, 5))}`).join('\n') || 'No pages have been generated yet.';
  if (has('page', 'screen', 'how many')) return `“${p.name}” has ${p.pages.length} page${p.pages.length === 1 ? '' : 's'}: ${p.pages.map((x) => `${x.name}${x.generated ? '' : ' (not generated)'}`).join(', ')}.`;
  if (has('device', 'mobile', 'desktop', 'tablet')) return `“${p.name}” is designed for ${p.device.toLowerCase()}. You can preview it on Mobile, Tablet or Desktop from the full-screen preview.`;
  if (has('when', 'created', 'date', 'old')) return `“${p.name}” was created ${new Date(p.createdAt).toDateString()} and last updated ${ago(p.updatedAt)}.`;
  if (has('share', 'collaborat')) return p.shared ? `“${p.name}” is shared with ${p.shared} people.` : `“${p.name}” is not shared with anyone.`;
  return `“${p.name}” is ${p.kind === 'website' ? 'a website' : 'an app UI'} for ${p.device.toLowerCase()} with ${p.pages.length} page${p.pages.length === 1 ? '' : 's'} (${p.pages.map((x) => x.name).join(', ')}), last updated ${ago(p.updatedAt)}. Ask me about its pages, colours, fonts, buttons, status, exports or your credits. (Tip: connect your Gemini key in Settings → Integrations and I can answer any question in your own words.)`;
}

function factsForPrompt(p: ProjectFacts | null, a: AccountFacts) {
  return JSON.stringify({
    account: { plan: a.plan, credits: a.credits, subscriptionStatus: a.subscriptionStatus, periodEnds: a.renewsOrExpiresAt ? new Date(a.renewsOrExpiresAt).toDateString() : undefined },
    pricing: { askingAssistant: 'free', generatePerScreen: 5, edit: 2, htmlZip: 1, react: 2, png: 'free', html: 'free', plansAutoRenew: false },
    project: p && { name: p.name, kind: p.kind, device: p.device, created: new Date(p.createdAt).toDateString(), updated: ago(p.updatedAt), shared: p.shared, pages: p.pages, recentJobs: p.jobs.map((j) => ({ ...j, createdAt: ago(j.createdAt) })) },
  }).slice(0, 14_000);
}

export async function answer(uid: string, question: string, projectId: string | undefined, history: { role: string; text: string }[]): Promise<{ text: string; source: 'gemini' | 'built-in' }> {
  const [p, a] = await Promise.all([projectId ? collectProjectFacts(uid, projectId) : Promise.resolve(null), collectAccountFacts(uid)]);
  const geminiOn = (await listConnectionStatus(uid).catch(() => [])).some((c) => c.provider === 'gemini' && c.connected);
  if (geminiOn) {
    try {
      const prompt = [
        'You are the Designo assistant inside a mobile app that designs app UIs and websites with Google Stitch.',
        'You are READ-ONLY: you answer questions only. You can NOT change, edit, generate or delete anything. If asked to change something, say you can only answer questions and tell them to open the project and use the "AI edit" tab, or the Studio.',
        'Answer using ONLY the facts below; if something is not in the facts, say you do not know. Be friendly, concise (max ~120 words), plain text, no markdown headings. Asking you is free.',
        `FACTS: ${factsForPrompt(p, a)}`,
        history.length ? `RECENT CHAT:\n${history.slice(-8).map((h) => `${h.role}: ${h.text.slice(0, 400)}`).join('\n')}` : '',
        `USER QUESTION: ${question}`,
      ].filter(Boolean).join('\n\n');
      const out = await Promise.race([gemini.generateText(uid, prompt), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000))]);
      const text = String(out ?? '').replace(/\*\*/g, '').trim();
      if (text.length > 1) return { text: text.slice(0, 2500), source: 'gemini' };
    } catch (e) { logger.warn({ uid, msg: (e as Error).message }, 'assistant gemini failed; using built-in answer'); }
  }
  return { text: builtInAnswer(question, p, a), source: 'built-in' };
}
