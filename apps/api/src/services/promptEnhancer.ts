import type { DeviceType, ProjectKind } from '@designforge/shared';
import { gemini } from './gemini.js';
import { listConnectionStatus } from './connections.js';
import { logger } from '../lib/logger.js';

/**
 * Prompt enhancement, run before anything is sent to Stitch.
 *
 * - If the user has connected THEIR OWN Gemini key, Gemini rewrites the prompt into a detailed design
 *   brief, a shared theme and one detailed prompt per screen. There is no shared/operator Gemini key.
 * - Otherwise (or if Gemini fails) a deterministic built-in planner produces the same structure from
 *   category templates, so short prompts like "create a fitness app" still become a complete app.
 *
 * Output mode:
 *   'single': exactly one screen (enhanced prompt)
 *   'app':    a complete multi-screen app / multi-page website (`maxScreens`)
 *   'auto':   Gemini / heuristics decide: a broad "make an X app" becomes an app, a specific screen stays single.
 */
export type OutputMode = 'auto' | 'single' | 'app';
export interface ThemeSpec { mood: string; primary: string; accent: string; background: string; dark: boolean; headingFont: string; bodyFont: string; corners: string }
export interface ScreenSpec { name: string; prompt: string }
export interface DesignPlan {
  enhancer: 'gemini' | 'built-in';
  appName: string;
  category: string;
  isFullApp: boolean;
  theme: ThemeSpec;
  designBrief: string;
  navigation: string[];
  screens: ScreenSpec[];
  /** Completing an existing app: copy this screen's style instead of the planned theme. */
  matchStyle?: string;
}
export interface EnhanceInput { prompt: string; kind: ProjectKind; device: DeviceType; style?: string; category?: string; mode: OutputMode; maxScreens: number; pageName?: string; pageNames?: string[]; /** Varies name/colours between runs of the same prompt. */ variation?: string }

const NO_QUESTIONS = 'Generate exactly one screen now. Do not ask clarifying questions or propose a plan first: make sensible assumptions for anything unspecified.';

// ───────────────────────── Gemini planner ─────────────────────────

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    appName: { type: 'STRING' },
    category: { type: 'STRING' },
    isFullApp: { type: 'BOOLEAN' },
    theme: {
      type: 'OBJECT',
      properties: {
        mood: { type: 'STRING' }, primary: { type: 'STRING' }, accent: { type: 'STRING' }, background: { type: 'STRING' },
        dark: { type: 'BOOLEAN' }, headingFont: { type: 'STRING' }, bodyFont: { type: 'STRING' }, corners: { type: 'STRING' },
      },
      required: ['mood', 'primary', 'accent', 'background', 'dark', 'headingFont', 'bodyFont', 'corners'],
    },
    designBrief: { type: 'STRING' },
    navigation: { type: 'ARRAY', items: { type: 'STRING' } },
    screens: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, prompt: { type: 'STRING' } }, required: ['name', 'prompt'] } },
  },
  required: ['appName', 'category', 'isFullApp', 'theme', 'designBrief', 'navigation', 'screens'],
};

function geminiInstruction(i: EnhanceInput) {
  const surface = i.kind === 'website' ? 'website' : `${i.device.toLowerCase()} app`;
  const unit = i.kind === 'website' ? 'pages' : 'screens';
  const modeRule = i.mode === 'single'
    ? `Return exactly 1 item in "screens"${i.pageName ? ` (the "${i.pageName}" ${unit === 'pages' ? 'page' : 'screen'})` : ''} and set isFullApp=false.`
    : i.mode === 'app'
      ? `Return EVERY ${unit === 'pages' ? 'page' : 'screen'} this ${surface} needs to fully deliver the request (at least 2; every ${unit === 'pages' ? 'page' : 'screen'} the user names, plus the ones the product obviously needs) and set isFullApp=true. Use as many as the request genuinely needs (a typical complete ${surface} has 4–8; bigger requests more); never pad with filler. The user can afford ${i.maxScreens}; only go beyond that when the user explicitly names more.`
      : `Decide: if the request is broad (e.g. "create a fitness app", "a website for my bakery") set isFullApp=true and return every ${unit === 'pages' ? 'page' : 'screen'} the product needs (every one the user names; as many as genuinely needed, typically 4–8, never filler; the user can afford ${i.maxScreens}); if it describes one specific screen/page, set isFullApp=false and return exactly 1.`;
  return [
    'You are a senior product designer who writes prompts for Google Stitch, an AI that turns ONE text prompt into ONE UI screen.',
    `Turn the user's request into a production-quality design plan for a ${surface}.`,
    modeRule,
    'Rules:',
    '- "designBrief": 3-5 sentences about the product, audience, brand personality and visual language. It is prepended to every screen prompt.',
    '- "theme": one cohesive visual system. Colors as hex. Choose fonts available on Google Fonts. "corners" like "rounded 16px cards, pill buttons".',
    `- "navigation": the ${i.kind === 'website' ? 'header navigation links' : 'bottom tab bar items (4-5)'} shared by all ${unit}. Each item MUST be the exact name of one of the ${unit} in "screens".`,
    '- Everything must be specific to THIS request: original app name, original people/place/product names, numbers and copy. Never reuse stock sample content.',
    `- Each "screens[].prompt" (120-220 words) describes ONE ${unit === 'pages' ? 'page' : 'screen'} completely: layout from top to bottom, every section and component, realistic sample content (names, numbers, prices, dates), states such as selected tab, and key interactions. Mention the shared navigation with the current item active.`,
    '- Never ask questions. Make confident, specific product decisions.',
    '- Keep the first screen the most representative one (home / dashboard / landing).',
    i.pageNames?.length && i.mode !== 'single' ? `- Use exactly these ${unit}, in this order: ${i.pageNames.join(', ')}.` : '',
    i.style ? `- Visual style requested by the user: ${i.style}.` : '',
    i.category ? `- Business category: ${i.category}.` : '',
  ].filter(Boolean).join('\n');
}

function validPlan(x: any): x is Omit<DesignPlan, 'enhancer'> {
  return x && typeof x.appName === 'string' && x.theme && typeof x.designBrief === 'string'
    && Array.isArray(x.screens) && x.screens.length > 0 && x.screens.every((s: any) => typeof s?.name === 'string' && typeof s?.prompt === 'string' && s.prompt.length > 20);
}

async function planWithGemini(uid: string, i: EnhanceInput): Promise<DesignPlan> {
  const json = await gemini.generateJson(uid, `${geminiInstruction(i)}\n\nUser request:\n"""${i.prompt.slice(0, 3000)}"""`, SCHEMA, 45_000);
  if (!validPlan(json)) throw new Error('Gemini returned an incomplete plan');
  // Screens the user explicitly named are all kept (credits are checked by the job, all-or-nothing).
  const limit = i.mode === 'single' ? 1 : 30;
  const screens = json.screens.slice(0, limit).map((s) => ({ name: s.name.trim().slice(0, 60) || 'Screen', prompt: s.prompt.trim().slice(0, 2500) }));
  return {
    enhancer: 'gemini',
    appName: json.appName.trim().slice(0, 60) || 'My app',
    category: String(json.category ?? 'app').slice(0, 40),
    isFullApp: i.mode === 'app' || (i.mode === 'auto' && !!json.isFullApp && screens.length > 1),
    theme: json.theme,
    designBrief: json.designBrief.trim().slice(0, 1200),
    navigation: (json.navigation ?? []).map(String).slice(0, 6),
    screens,
  };
}

// ───────────────────────── Built-in planner ─────────────────────────

/*
 * The built-in planner (used when the user has no Gemini key) is PROMPT-DRIVEN: the app name, colours,
 * fonts, screen list and every screen prompt come from the user's own request. Categories only add a
 * STRUCTURE hint (which sections a screen usually has) — never fixed names, people or numbers, so two
 * different requests never produce the same design.
 */
interface Category { keys: RegExp; category: string; mood: string; screens: ScreenSpec[] }

const CATEGORIES: Category[] = [
  { keys: /\b(fitness|gym|workout|exercise|training|yoga|running|health|steps|diet|nutrition)\b/i, category: 'fitness', mood: 'energetic, motivating, athletic', screens: [
    { name: 'Home', prompt: 'today’s summary with progress visuals, key stats, today’s plan with a clear start action, recommendations and a streak/consistency element' },
    { name: 'Workouts', prompt: 'searchable library with filter chips, a featured programme and cards showing duration, difficulty and effort' },
    { name: 'Activity', prompt: 'an in-progress session or tracker: big live metric, timer/progress, current step, controls and what comes next' },
    { name: 'Progress', prompt: 'period switcher, charts over time, personal records, body or health metrics and achievements' },
    { name: 'Profile', prompt: 'user header with stats, goals, connected devices, reminders, preferences and account actions' },
  ] },
  { keys: /\b(food|restaurant|delivery|recipe|cafe|coffee|meal|grocery|pizza|bakery|kitchen)\b/i, category: 'food', mood: 'warm, appetising, inviting', screens: [
    { name: 'Home', prompt: 'location selector, search, category chips, a promotion, popular places/items with photos and ratings, and a reorder section' },
    { name: 'Menu', prompt: 'place or menu detail: hero image, rating and timing, category tabs, item rows with photo, description, price and add button, and a cart summary bar' },
    { name: 'Cart', prompt: 'items with quantity steppers and options, add-ons, promo code, cost breakdown and checkout button' },
    { name: 'Orders', prompt: 'live order status with a progress timeline and map/ETA, courier or pickup details, and past orders' },
    { name: 'Profile', prompt: 'user header, rewards, saved addresses, payment methods, favourites, settings and help' },
  ] },
  { keys: /\b(shop|store|e-?commerce|fashion|clothing|marketplace|retail|sneaker|boutique)\b/i, category: 'e-commerce', mood: 'stylish, premium, editorial', screens: [
    { name: 'Home', prompt: 'search, campaign banner, category shortcuts, new arrivals grid and a timed deal' },
    { name: 'Product', prompt: 'image gallery, title, price, rating, variant selectors, description, reviews and add-to-cart' },
    { name: 'Cart', prompt: 'line items with variants and quantity, saved for later, promo code, totals and checkout' },
    { name: 'Checkout', prompt: 'step indicator, address, delivery options, payment methods, order summary and pay button' },
    { name: 'Profile', prompt: 'account header, orders with statuses, addresses, payments, returns and settings' },
  ] },
  { keys: /\b(finance|bank|banking|wallet|budget|expense|payment|crypto|invest|money|fintech|earn|earning|income|payout)\b/i, category: 'finance', mood: 'trustworthy, precise, calm', screens: [
    { name: 'Home', prompt: 'balance overview with privacy toggle, quick actions, accounts or cards, a budget/goal element and recent transactions' },
    { name: 'Transactions', prompt: 'searchable history with filters, grouped by day with totals and clear credit/debit colours' },
    { name: 'Insights', prompt: 'period selector, category breakdown chart, trend vs previous period, goals and a smart tip' },
    { name: 'Cards', prompt: 'card or account management: visual card, freeze/limits controls, settings and related activity' },
    { name: 'Profile', prompt: 'verified user header, personal details, security options, linked accounts, statements and support' },
  ] },
  { keys: /\b(travel|trip|hotel|flight|booking|tour|vacation|stay)\b/i, category: 'travel', mood: 'inspiring, airy, adventurous', screens: [
    { name: 'Explore', prompt: 'search card for destination, dates and guests, category chips, featured destinations and experiences' },
    { name: 'Details', prompt: 'gallery, title, rating, amenities, host or provider, map, reviews and a sticky booking bar' },
    { name: 'Trips', prompt: 'upcoming trip with countdown, day-by-day itinerary, documents and past trips' },
    { name: 'Saved', prompt: 'wishlist collections and saved places' },
    { name: 'Profile', prompt: 'traveller header, preferences, payments, notifications and help' },
  ] },
  { keys: /\b(education|learning|course|school|study|quiz|tutor|language|class)\b/i, category: 'education', mood: 'friendly, encouraging, focused', screens: [
    { name: 'Home', prompt: 'continue-learning card with progress, daily goal, streak, recommendations and upcoming sessions' },
    { name: 'Courses', prompt: 'catalogue with search, categories, featured course and course cards with level and rating' },
    { name: 'Lesson', prompt: 'lesson player or reader with progress through the module, notes, key points and next action' },
    { name: 'Practice', prompt: 'an interactive exercise or quiz with progress, question, options and feedback' },
    { name: 'Profile', prompt: 'level, badges, certificates, activity chart and settings' },
  ] },
  { keys: /\b(social|chat|messag|community|dating|creator|forum|network|friends)\b/i, category: 'social', mood: 'lively, personal, expressive', screens: [
    { name: 'Home', prompt: 'personalised feed of posts with media, reactions and comments, plus stories or highlights' },
    { name: 'Discover', prompt: 'search, trending topics, suggested people or groups and featured content' },
    { name: 'Messages', prompt: 'conversation list with unread states and an open chat with message bubbles and composer' },
    { name: 'Notifications', prompt: 'grouped activity with avatars, actions and timestamps' },
    { name: 'Profile', prompt: 'cover and avatar, bio, stats, content grid and edit/follow actions' },
  ] },
];

const GENERIC: Category = { keys: /./, category: 'app', mood: 'modern, clean, confident', screens: [
  { name: 'Home', prompt: 'the main dashboard for this product: a summary of what matters most, primary actions and the most important content' },
  { name: 'Explore', prompt: 'search, filters and browsable content specific to this product' },
  { name: 'Details', prompt: 'the detail view of the product’s main item with all its key information and the main action' },
  { name: 'Activity', prompt: 'history, progress or notifications relevant to this product' },
  { name: 'Profile', prompt: 'user header, stats, preferences, account and help' },
] };

const WEB_PAGES: ScreenSpec[] = [
  { name: 'Home', prompt: 'sticky header with logo, navigation and CTA; hero with headline, sub-headline, CTAs and imagery; proof/trust; key features; testimonials; offer highlight; final CTA; footer' },
  { name: 'About', prompt: 'story with imagery, mission and values, team, milestones, CTA and footer' },
  { name: 'Services', prompt: 'intro, service or pricing cards with features and CTA, comparison, FAQ, CTA and footer' },
  { name: 'Contact', prompt: 'contact form, contact details, map, opening hours, FAQ snippet and footer' },
  { name: 'Blog', prompt: 'featured article, category filter, article cards with image, title, excerpt, author and date, newsletter signup and footer' },
  { name: 'Gallery', prompt: 'filterable grid of work with captions, a highlighted case study, CTA and footer' },
];

const PALETTES: (ThemeSpec & { tags: string })[] = [
  { tags: 'dark neon bold energetic', mood: 'bold, high-contrast', primary: '#A3E635', accent: '#22D3EE', background: '#0B0F17', dark: true, headingFont: 'Space Grotesk', bodyFont: 'Inter', corners: 'rounded 20px cards, pill buttons' },
  { tags: 'dark luxury premium gold elegant', mood: 'luxurious, refined', primary: '#D4AF37', accent: '#F5E6C8', background: '#0E0E10', dark: true, headingFont: 'Playfair Display', bodyFont: 'Inter', corners: 'subtle 12px corners, thin borders' },
  { tags: 'dark purple creative', mood: 'creative, immersive', primary: '#8B5CF6', accent: '#F472B6', background: '#0F0B1E', dark: true, headingFont: 'Sora', bodyFont: 'Inter', corners: 'rounded 18px glassy cards' },
  { tags: 'dark blue tech calm', mood: 'focused, technical', primary: '#3B82F6', accent: '#10B981', background: '#0B1220', dark: true, headingFont: 'Manrope', bodyFont: 'Inter', corners: 'rounded 14px cards' },
  { tags: 'dark red orange energetic', mood: 'intense, dynamic', primary: '#F97316', accent: '#EF4444', background: '#121212', dark: true, headingFont: 'Outfit', bodyFont: 'Inter', corners: 'rounded 16px cards, bold buttons' },
  { tags: 'light minimal clean blue trustworthy', mood: 'clean, trustworthy', primary: '#2563EB', accent: '#0EA5E9', background: '#F8FAFC', dark: false, headingFont: 'Plus Jakarta Sans', bodyFont: 'Inter', corners: 'rounded 16px cards, pill buttons' },
  { tags: 'light warm orange food friendly', mood: 'warm, appetising', primary: '#EA580C', accent: '#FACC15', background: '#FFF8F1', dark: false, headingFont: 'Epilogue', bodyFont: 'Inter', corners: 'rounded 20px cards with soft shadows' },
  { tags: 'light green fresh nature health eco', mood: 'fresh, natural', primary: '#16A34A', accent: '#84CC16', background: '#F6FBF4', dark: false, headingFont: 'DM Sans', bodyFont: 'DM Sans', corners: 'rounded 18px cards' },
  { tags: 'light pastel pink playful soft cute', mood: 'playful, soft', primary: '#EC4899', accent: '#A78BFA', background: '#FFF7FB', dark: false, headingFont: 'Nunito', bodyFont: 'Nunito', corners: 'very rounded 24px cards, pill buttons' },
  { tags: 'light purple modern creative', mood: 'modern, expressive', primary: '#7C3AED', accent: '#F59E0B', background: '#FAF8FF', dark: false, headingFont: 'Sora', bodyFont: 'Inter', corners: 'rounded 16px cards' },
  { tags: 'light teal calm medical wellness', mood: 'calm, caring', primary: '#0D9488', accent: '#38BDF8', background: '#F4FBFB', dark: false, headingFont: 'Manrope', bodyFont: 'Inter', corners: 'rounded 16px cards, soft shadows' },
  { tags: 'light black white editorial fashion minimal', mood: 'editorial, minimal', primary: '#111111', accent: '#E11D48', background: '#FFFFFF', dark: false, headingFont: 'Playfair Display', bodyFont: 'Inter', corners: 'sharp 4px corners, generous whitespace' },
  { tags: 'light yellow sunny friendly fun', mood: 'sunny, upbeat', primary: '#CA8A04', accent: '#2563EB', background: '#FFFBEB', dark: false, headingFont: 'Outfit', bodyFont: 'Inter', corners: 'rounded 20px cards' },
  { tags: 'light red bold sporty', mood: 'bold, sporty', primary: '#DC2626', accent: '#111827', background: '#FAFAFA', dark: false, headingFont: 'Archivo', bodyFont: 'Inter', corners: 'rounded 12px cards, strong buttons' },
];
const COLOR_WORDS: Record<string, string> = { red: '#DC2626', orange: '#EA580C', yellow: '#CA8A04', gold: '#D4AF37', green: '#16A34A', teal: '#0D9488', cyan: '#06B6D4', blue: '#2563EB', navy: '#1E3A8A', purple: '#7C3AED', violet: '#7C3AED', pink: '#EC4899', black: '#111111', brown: '#92400E', lime: '#84CC16' };

/** Screens that are steps in a flow rather than tabs in the bar. */
export const NOT_A_TAB = /\b(log ?in|sign ?in|sign ?up|register|onboarding|splash|welcome|checkout|payment|verify|otp|forgot)\b/i;

/** Stable 32-bit hash: the same request always gives the same plan, different requests differ. */
function hash(s: string) { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; }

const STOP = new Set('a an the my our your for with and or to of in on at by app apps application website site web mobile android ios create make build design develop new simple modern creative complete full entire whole beautiful best good nice cool platform that which screen screens page pages section sections i we want need please like some all every called named using based dark light neon pastel calm minimal clean bold soft look theme style colour color colors colours red orange yellow gold green teal cyan blue navy purple violet pink black white brown lime premium luxury elegant cute playful fresh login signin signup register onboarding splash welcome dashboard home settings profile checkout cart account service services seniors kids users people'.split(' '));
const keywords = (req: string) => (req.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

/** An original brand name built from the request ("a creative fitness app" → e.g. "Fitloop"). */
export function brandName(req: string, seed = hash(req.toLowerCase())): string {
  const w = keywords(req)[0] ?? 'nova';
  const cut = w.search(/[aeiouy][^aeiouy]/);
  const root = w.length <= 5 ? w : w.slice(0, Math.max(3, cut + 2));
  const SUF = ['ly', 'io', 'ify', 'hub', 'nest', 'loop', 'wave', 'mint', 'base', 'go', 'spot', 'lab', 'pal', 'verse'];
  return root.charAt(0).toUpperCase() + root.slice(1) + SUF[seed % SUF.length];
}

/** Colours/fonts from the request's own words (dark, pastel, luxury, "blue"…); otherwise varied by request. */
export function themeFor(req: string, category: Category, style: string | undefined, seed: number): ThemeSpec {
  const text = `${req} ${style ?? ''}`.toLowerCase();
  const wantsDark = /\b(dark|night|neon|black theme|amoled)\b/.test(text);
  const wantsLight = /\b(light|white|bright|pastel|minimal|clean)\b/.test(text);
  const words = new Set(text.match(/[a-z]+/g) ?? []);
  let pool = PALETTES.filter((p) => (wantsDark ? p.dark : wantsLight ? !p.dark : true));
  // The user's own words win; the category's mood is only a tie-breaker.
  const tagsOf = (p: { tags: string }) => p.tags.split(' ').filter((t) => t !== 'dark' && t !== 'light');
  const score = (p: { tags: string }) => tagsOf(p).filter((t) => words.has(t)).length;
  const best = Math.max(0, ...pool.map(score));
  const byMood = pool.filter((p) => tagsOf(p).some((t) => category.mood.includes(t)));
  if (best > 0) pool = pool.filter((p) => score(p) === best); else if (byMood.length) pool = byMood;
  const { tags: _t, ...pick } = pool[seed % pool.length];
  const color = Object.keys(COLOR_WORDS).find((c) => words.has(c));
  return {
    ...pick,
    primary: color ? COLOR_WORDS[color] : pick.primary,
    mood: [style, `${pick.mood}; ${category.mood}`].filter(Boolean).join('; '),
  };
}

/** Screens the user named themselves: "with login, wallet and settings screens", "pages: Home, Menu, Contact". */
export function listedScreens(req: string): string[] {
  const m = /(?:screens?|pages?|sections?)\s*(?::|like|such as|including|for)\s*([^.\n]+)/i.exec(req)
    ?? /(?:with|including|has|having|containing)\s+([^.\n]+?)\s+(?:screens?|pages?|sections?)\b/i.exec(req);
  if (!m) return [];
  const seen = new Set<string>();
  return m[1].split(/,|\band\b|&|\/|\+/i).map((x) => x.trim().replace(/^(a|an|the)\s+/i, '').replace(/\s+(screen|page|section)s?$/i, ''))
    .filter((x) => x && x.split(/\s+/).length <= 4 && /[a-z]/i.test(x))
    .map((x) => titleCase(x.toLowerCase()).slice(0, 40))
    .filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** A short name for a single requested screen ("a login screen for…" → "Login"). */
function singleName(req: string): string | undefined {
  const m = /\b(?:an?|the|my)?\s*([a-z][a-z-]*(?:\s[a-z][a-z-]*)?)\s+(?:screen|page)\b/i.exec(req);
  const n = m?.[1]?.replace(/^(a|an|the|my)\s+/i, '').trim();
  return n && !/^(new|main|one|this|first|single|app|mobile|web|home ?page)$/i.test(n) ? titleCase(n.toLowerCase()).slice(0, 40) : undefined;
}

/** Broad "make me an X app/website" request → full app. A specific screen/page stays single. */
export function looksLikeFullAppRequest(prompt: string) {
  const p = prompt.toLowerCase();
  const specific = /\b(screen|page|login|sign ?in|sign ?up|onboarding|checkout|cart|settings|profile|dashboard|detail|modal|form|landing)\b/.test(p);
  const broad = /\b(app|application|website|site|platform|startup|product)\b/.test(p);
  return broad && !specific && p.split(/\s+/).length <= 40;
}

function titleCase(s: string) { return s.replace(/\b\w/g, (m) => m.toUpperCase()); }

export function planBuiltIn(i: EnhanceInput): DesignPlan {
  const req = i.prompt.trim();
  const seed = hash(`${req.toLowerCase()}|${i.variation ?? ''}`);
  const cat = CATEGORIES.find((t) => t.keys.test(`${req} ${i.category ?? ''}`)) ?? GENERIC;
  const listed = listedScreens(req);
  const full = i.mode === 'app' || (i.mode === 'auto' && (looksLikeFullAppRequest(req) || listed.length >= 2));
  const named = /(?:called|named)\s+["“]?([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*){0,3})/.exec(req)?.[1]?.trim();
  const appName = named ? titleCase(named) : brandName(req, seed);
  const unit = i.kind === 'website' ? 'page' : 'screen';
  const pool = i.kind === 'website' ? WEB_PAGES : cat.screens;
  const hintFor = (n: string) => (pool.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? WEB_PAGES.find((s) => s.name.toLowerCase() === n.toLowerCase()))?.prompt;
  const screenPrompt = (n: string) => {
    const hint = hintFor(n);
    return `The ${n} ${unit} of ${appName}. It must serve exactly what the user asked for: "${req.slice(0, 600)}". ${hint ? `Typical structure (adapt it to the request): ${hint}.` : `Include the content, components and actions this ${unit} needs for that request.`} Invent original, specific content for THIS product (names, numbers, images, copy) — never generic placeholders or the same sample data as other apps.`;
  };
  let screens: ScreenSpec[];
  if (full) {
    // Every screen the user named; otherwise the screens this kind of product needs (credits are the only limit).
    const names = i.pageNames?.length ? i.pageNames : listed.length >= 2 ? listed : pool.map((s) => s.name).slice(0, Math.max(1, i.maxScreens));
    screens = names.map((n) => ({ name: n, prompt: screenPrompt(n) }));
  } else {
    const name = i.pageName || singleName(req) || (looksLikeFullAppRequest(req) ? pool[0].name : 'Screen 1');
    const hint = hintFor(name);
    screens = [{ name, prompt: `${req}${hint ? `\n\nTypical structure (adapt it to the request): ${hint}.` : ''}\n\nUse original, specific content for this product — no generic placeholders.` }];
  }
  const theme = themeFor(req, cat, i.style, seed);
  const kw = keywords(req).slice(0, 6).join(', ');
  return {
    enhancer: 'built-in', appName, category: i.category || cat.category, isFullApp: full && screens.length > 1, theme,
    designBrief: `${appName} is a ${i.kind === 'website' ? 'website' : `${i.device.toLowerCase()} app`} built for this request: "${req.slice(0, 500)}". ${kw ? `Its subject: ${kw}. ` : ''}The visual language is ${theme.mood}. Every element, label and piece of content must be specific to this request.`,
    // Sign-in / onboarding / checkout style screens are steps, not tabs.
    navigation: screens.length > 1 ? screens.map((s) => s.name).filter((n) => !NOT_A_TAB.test(n)).slice(0, i.kind === 'website' ? 6 : 5) : [],
    screens,
  };
}

// ───────────────────────── Public API ─────────────────────────

export async function enhance(uid: string, i: EnhanceInput): Promise<DesignPlan> {
  // No small cap: the number of screens is what the request needs; credits are the limit (checked by the job).
  const maxScreens = Math.min(Math.max(i.maxScreens, 1), 30);
  const input = { ...i, maxScreens };
  const geminiOn = (await listConnectionStatus(uid).catch(() => [])).some((c) => c.provider === 'gemini' && c.connected);
  if (geminiOn) {
    try {
      return await planWithGemini(uid, input);
    } catch (e) {
      logger.warn({ uid, msg: (e as Error).message }, 'gemini prompt enhancement failed; using built-in planner');
    }
  }
  return planBuiltIn(input);
}

/** The exact prompt sent to Stitch for screen `index` of the plan. */
export function stitchPromptFor(plan: DesignPlan, index: number, kind: ProjectKind): string {
  const s = plan.screens[index];
  const t = plan.theme;
  const unit = kind === 'website' ? 'page' : 'screen';
  const parts = [
    `${plan.appName}: ${s.name} ${unit}.`,
    plan.designBrief,
    plan.matchStyle ? `Visual system: copy the existing screen's look exactly: ${plan.matchStyle}. Same header, cards, buttons, icons and bottom bar. Consistent 4/8px spacing, WCAG AA contrast, realistic content (no lorem ipsum).` : `Visual system: ${t.mood}. ${t.dark ? 'Dark' : 'Light'} theme. Background ${t.background}, primary ${t.primary}, accent ${t.accent}. Headings in ${t.headingFont}, body in ${t.bodyFont}. ${t.corners}. Consistent 4/8px spacing, WCAG AA contrast, realistic content (no lorem ipsum).`,
    plan.isFullApp && plan.screens.length > 1
      ? `This is ${unit} ${index + 1} of ${plan.screens.length} of the same product (${plan.screens.map((x) => x.name).join(', ')}). ${plan.navigation.length ? `Use the shared ${kind === 'website' ? 'header navigation' : 'bottom tab bar'} with EXACTLY these labels, in this order: ${plan.navigation.join(', ')}${plan.navigation.some((n) => n.toLowerCase() === s.name.toLowerCase()) ? ` ("${s.name}" is the active item)` : ''}.` : ''} Buttons and links that open another ${unit} of the app use that ${unit}'s name in their label. Keep every ${unit} visually consistent with the others.`
      : '',
    `${titleCase(unit)} details: ${s.prompt}`,
    NO_QUESTIONS,
  ];
  return parts.filter(Boolean).join('\n\n').slice(0, 7000);
}

// ───────────────────────── Automatic choices (no pickers in the apps) ─────────────────────────

/** Picks the device from the request: websites/dashboards → desktop, "tablet/ipad" → tablet, else mobile. */
export function autoDevice(prompt: string, kind: ProjectKind, fallback: DeviceType = 'MOBILE'): DeviceType {
  if (kind === 'website') return 'DESKTOP';
  const p = prompt.toLowerCase();
  if (/\b(tablet|ipad)\b/.test(p)) return 'TABLET';
  if (/\b(mobile|android|ios|iphone|phone)\b/.test(p)) return 'MOBILE';
  if (/\b(website|web ?site|landing ?page|web ?page|web ?app|webapp|desktop|saas|admin (panel|dashboard)|portfolio site|homepage|e-?commerce site|blog)\b/.test(p)) return 'DESKTOP';
  if (/\bapp\b/.test(p)) return 'MOBILE';
  return fallback === 'AGNOSTIC' ? 'MOBILE' : fallback;
}

/** Project kind for a fresh studio project created from a prompt. */
export function autoKind(prompt: string): 'ui' | 'website' {
  return /\b(website|web ?site|landing ?page|web ?page|homepage|portfolio site|blog site)\b/i.test(prompt) ? 'website' : 'ui';
}

/**
 * Small Gemini task: turns a short chat request ("make it premium") into a precise, self-contained
 * Stitch edit instruction. Uses the user's own Gemini key only; silently falls back to the raw text.
 */
export async function enhanceEditInstruction(uid: string, message: string, ctx: { pageName: string; section?: string }): Promise<string> {
  const geminiOn = (await listConnectionStatus(uid).catch(() => [])).some((c) => c.provider === 'gemini' && c.connected);
  if (!geminiOn) return message;
  try {
    const out = await Promise.race([
      gemini.generateText(uid, [
        'Rewrite the user\'s change request for Google Stitch, which edits an existing UI screen.',
        `Screen: "${ctx.pageName}".${ctx.section ? ` Only the "${ctx.section}" section may change.` : ''}`,
        'Write 2-5 concrete sentences: exactly what to change (layout, colours as hex, typography, spacing, content), and say that everything else stays the same.',
        'No questions, no preamble, no markdown. Output only the instruction.',
        `User request: """${message.slice(0, 1500)}"""`,
      ].join('\n')),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20_000)),
    ]);
    const clean = String(out ?? '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
    return clean.length >= 10 ? `${clean.slice(0, 1800)}\n\n(Original request: ${message.slice(0, 300)})` : message;
  } catch (e) {
    logger.warn({ uid, msg: (e as Error).message }, 'gemini edit enhancement failed; using raw instruction');
    return message;
  }
}
