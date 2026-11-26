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
}
export interface EnhanceInput { prompt: string; kind: ProjectKind; device: DeviceType; style?: string; category?: string; mode: OutputMode; maxScreens: number; pageName?: string; pageNames?: string[] }

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
      ? `Return exactly ${i.maxScreens} ${unit} in "screens" that together form a complete ${surface}, and set isFullApp=true.`
      : `Decide: if the request is broad (e.g. "create a fitness app", "a website for my bakery") set isFullApp=true and return ${i.maxScreens} ${unit} forming a complete ${surface}; if it describes one specific screen/page, set isFullApp=false and return exactly 1.`;
  return [
    'You are a senior product designer who writes prompts for Google Stitch, an AI that turns ONE text prompt into ONE UI screen.',
    `Turn the user's request into a production-quality design plan for a ${surface}.`,
    modeRule,
    'Rules:',
    '- "designBrief": 3-5 sentences about the product, audience, brand personality and visual language. It is prepended to every screen prompt.',
    '- "theme": one cohesive visual system. Colors as hex. Choose fonts available on Google Fonts. "corners" like "rounded 16px cards, pill buttons".',
    `- "navigation": the ${i.kind === 'website' ? 'header navigation links' : 'bottom tab bar items (4-5)'} shared by all ${unit}.`,
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
  const limit = i.mode === 'single' ? 1 : i.maxScreens;
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

interface Template { keys: RegExp; category: string; name: string; theme: ThemeSpec; brief: string; nav: string[]; screens: ScreenSpec[]; web: ScreenSpec[] }
const T = (mood: string, primary: string, accent: string, background: string, dark: boolean, headingFont = 'Plus Jakarta Sans', bodyFont = 'Inter', corners = 'rounded 16px cards, pill-shaped buttons'): ThemeSpec =>
  ({ mood, primary, accent, background, dark, headingFont, bodyFont, corners });

const TEMPLATES: Template[] = [
  {
    keys: /\b(fitness|gym|workout|exercise|training|yoga|running|health tracker|steps)\b/i, category: 'fitness', name: 'PulseFit',
    theme: T('energetic, bold, athletic', '#A3E635', '#22D3EE', '#0B0F17', true, 'Plus Jakarta Sans', 'Inter', 'rounded 20px cards, pill buttons'),
    brief: 'PulseFit is a personal fitness companion for busy people who want to train smarter. It feels energetic and motivating, with bold numbers, progress rings and clear calls to action on a dark athletic canvas.',
    nav: ['Home', 'Workouts', 'Progress', 'Profile'],
    screens: [
      { name: 'Home', prompt: 'Home dashboard. Greeting "Good morning, Alex" with avatar and notification bell. Hero card with three concentric activity rings (Move 520/600 kcal, Exercise 38/45 min, Stand 9/12 h). Row of stat tiles: steps 8,432, heart rate 72 bpm, sleep 7h 20m. "Today\'s plan" card with a 30-min HIIT workout, duration, intensity and a "Start workout" button. Horizontal carousel of recommended workouts with image, title and minutes. Weekly streak strip Mon-Sun with checkmarks. Bottom tab bar with Home active.' },
      { name: 'Workouts', prompt: 'Workout library. Search bar and filter chips (All, Strength, HIIT, Yoga, Running, Mobility). Featured program banner "8-Week Strength Builder" with progress 3/8 weeks. Grid of workout cards with cover image, title, duration, difficulty badge and calories. Section "Quick sessions under 15 min". Bottom tab bar with Workouts active.' },
      { name: 'Active workout', prompt: 'Live workout session for "Full Body HIIT". Large circular interval timer 00:45 with round 3 of 8, current exercise "Burpees" with an illustration, next-up preview "Mountain climbers". Live heart-rate zone bar (Zone 4, 156 bpm), calories burned 214, elapsed 18:32. Big pause and skip controls, a lock button and music mini-player. Bottom tab bar hidden for focus.' },
      { name: 'Progress', prompt: 'Progress analytics. Segmented control Week / Month / Year. Line chart of workout minutes, bar chart of calories per day. Cards for personal records (Deadlift 120 kg, 5K 24:10), body metrics (weight 72.4 kg trend down), recovery score 82 with explanation. Achievement badges row. Bottom tab bar with Progress active.' },
      { name: 'Profile', prompt: 'Profile and settings. Header with avatar, name, membership badge "Pro member" and stats (workouts 148, streak 12 days, hours 96). Goals card with editable targets. List rows: connected devices (Apple Watch, Garmin), reminders, units, privacy, subscription, help, log out. Bottom tab bar with Profile active.' },
      { name: 'Nutrition', prompt: 'Nutrition tracker. Daily calories ring 1,640 / 2,200 kcal and macro bars (protein, carbs, fat). Meal sections Breakfast, Lunch, Dinner, Snacks with logged foods and calories plus "Add food" buttons. Water intake tracker with glasses. Bottom tab bar with Home active.' },
    ],
    web: [],
  },
  {
    keys: /\b(food|restaurant|delivery|recipe|cafe|coffee|meal|grocery|pizza|bakery)\b/i, category: 'food', name: 'Savora',
    theme: T('warm, appetizing, friendly', '#F97316', '#16A34A', '#FFF8F1', false, 'Poppins', 'Inter'),
    brief: 'Savora is a food ordering app that makes discovering and ordering great local food effortless. Warm, appetizing colors, large food photography and fast, friendly interactions.',
    nav: ['Home', 'Search', 'Orders', 'Profile'],
    screens: [
      { name: 'Home', prompt: 'Home feed. Delivery address selector "Home · 221B Baker St" and cart icon with badge. Search bar. Category chips with icons (Pizza, Burgers, Sushi, Healthy, Desserts). Promo banner "40% off your first order". "Popular near you" restaurant cards with photo, rating 4.7, delivery time 25-35 min, fee. "Order again" horizontal list. Bottom tab bar with Home active.' },
      { name: 'Restaurant', prompt: 'Restaurant detail for "Bella Napoli". Hero image, rating, cuisine, delivery time, distance and a favourite button. Sticky menu category tabs (Popular, Pizzas, Pasta, Drinks). Menu item rows with photo, name, short description, price and "+" add button. Floating "View cart · 2 items · $28.40" bar at the bottom.' },
      { name: 'Cart & checkout', prompt: 'Cart and checkout. Line items with quantity steppers, special instructions field, delivery address card, delivery time options (ASAP, schedule), payment method card, promo code input, price breakdown (subtotal, delivery, fees, tip selector) and a large "Place order · $31.90" button.' },
      { name: 'Order tracking', prompt: 'Live order tracking. Map with courier route, ETA "Arriving in 12 min", progress steps (Confirmed, Preparing, On the way, Delivered) with the current step highlighted, courier card with photo, rating and call/chat buttons, order summary. Bottom tab bar with Orders active.' },
      { name: 'Profile', prompt: 'Profile. Avatar and name, loyalty points card, saved addresses, payment methods, favourites, order history preview, notifications, help and log out. Bottom tab bar with Profile active.' },
      { name: 'Search', prompt: 'Search and filters. Search field with recent searches, trending dishes chips, filter sheet preview (price, rating, dietary: vegan, gluten-free), and results list of dishes and restaurants. Bottom tab bar with Search active.' },
    ],
    web: [],
  },
  {
    keys: /\b(shop|store|e-?commerce|fashion|clothing|marketplace|product|retail|sneaker)\b/i, category: 'e-commerce', name: 'Lumen Store',
    theme: T('clean, premium, minimal', '#111827', '#6366F1', '#FFFFFF', false, 'DM Sans', 'Inter', 'rounded 14px cards, soft shadows'),
    brief: 'Lumen Store is a premium shopping app with a calm, editorial look: generous white space, large product imagery and a frictionless path from discovery to checkout.',
    nav: ['Home', 'Categories', 'Wishlist', 'Cart', 'Profile'],
    screens: [
      { name: 'Home', prompt: 'Shop home. Logo, search and cart icons. Hero campaign banner "Autumn Collection" with CTA. Category circles (Women, Men, Shoes, Bags, Beauty). "New arrivals" product grid with image, brand, name, price and heart. "Trending now" carousel and a limited-time deal card with countdown. Bottom tab bar with Home active.' },
      { name: 'Product listing', prompt: 'Product listing for "Sneakers". Sort and filter bar, active filter chips (Size 42, Under $150), two-column product grid with rating, price, discount badge and color swatches. Bottom tab bar with Categories active.' },
      { name: 'Product detail', prompt: 'Product detail for "Aero Runner 2". Image gallery with dots, brand, name, rating 4.8 (1,204 reviews), price $129 with old price, color swatches, size selector grid, delivery estimate, expandable details/materials, reviews preview, sticky "Add to cart" and wishlist buttons.' },
      { name: 'Cart', prompt: 'Shopping cart with product rows (image, name, size, color, quantity stepper, price), saved for later, promo code field, order summary (subtotal, shipping, tax, total) and "Checkout" button. Bottom tab bar with Cart active.' },
      { name: 'Profile', prompt: 'Account. Avatar, name, membership tier, orders list with statuses, addresses, payment methods, returns, notification settings, help and log out. Bottom tab bar with Profile active.' },
      { name: 'Checkout', prompt: 'Checkout with stepper (Shipping, Payment, Review), address form, shipping method options with prices, card payment form with Apple/Google Pay buttons, order summary and "Pay $142.30" button.' },
    ],
    web: [],
  },
  {
    keys: /\b(finance|bank|banking|wallet|budget|expense|payment|crypto|invest|money|fintech)\b/i, category: 'finance', name: 'Vaultly',
    theme: T('trustworthy, modern, calm', '#2563EB', '#10B981', '#F8FAFC', false, 'Manrope', 'Inter', 'rounded 18px cards, subtle borders'),
    brief: 'Vaultly is a modern money app that helps people see, save and grow their money with confidence. Calm blues, crisp numbers and clear charts.',
    nav: ['Home', 'Cards', 'Payments', 'Insights', 'Profile'],
    screens: [
      { name: 'Home', prompt: 'Banking home. Greeting, total balance $12,480.55 with show/hide toggle, quick actions (Send, Request, Top up, Pay bills), account cards carousel, spending this month vs budget bar, recent transactions list with merchant logos, categories and amounts. Bottom tab bar with Home active.' },
      { name: 'Cards', prompt: 'Cards screen with a realistic virtual card (masked number, expiry), freeze toggle, spending limit slider, card settings (online payments, contactless, ATM), and recent card transactions. Bottom tab bar with Cards active.' },
      { name: 'Send money', prompt: 'Send money flow: recent contacts row with avatars, search contacts, amount keypad with large amount display $250.00, note field, source account selector, fee info and "Send" button. Bottom tab bar with Payments active.' },
      { name: 'Insights', prompt: 'Spending insights: month selector, donut chart by category (Food 32%, Transport 18%, Shopping 24%...), category list with amounts and change vs last month, savings goal progress cards and a smart tip card. Bottom tab bar with Insights active.' },
      { name: 'Profile', prompt: 'Profile and security: avatar, verified badge, personal details, security (Face ID, 2FA, change PIN), linked accounts, statements, support and log out. Bottom tab bar with Profile active.' },
      { name: 'Transactions', prompt: 'Transaction history with search, filter chips by category and date, grouped by day with totals, each row showing merchant, category icon, time and amount colored by debit/credit. Bottom tab bar with Home active.' },
    ],
    web: [],
  },
  {
    keys: /\b(travel|trip|hotel|flight|booking|tour|vacation|airbnb)\b/i, category: 'travel', name: 'Wandr',
    theme: T('adventurous, airy, inspiring', '#0EA5E9', '#F59E0B', '#F8FAFC', false, 'Outfit', 'Inter'),
    brief: 'Wandr is a travel planning app that inspires trips and makes booking stays and experiences simple, with big destination photography and airy layouts.',
    nav: ['Explore', 'Trips', 'Saved', 'Profile'],
    screens: [
      { name: 'Explore', prompt: 'Explore home: "Where to next?" search card with destination, dates and guests, category chips (Beach, Mountains, City, Countryside), featured destination cards with photo and price from, "Top experiences" carousel. Bottom tab bar with Explore active.' },
      { name: 'Search results', prompt: 'Stay search results for "Bali, 12-18 Jun, 2 guests": filter bar, map/list toggle, listing cards with photo carousel, rating, price per night and total, and favourite heart. Bottom tab bar with Explore active.' },
      { name: 'Listing detail', prompt: 'Villa detail: photo gallery, title, rating and reviews, host card, amenities grid, location map preview, availability calendar, house rules, and sticky booking bar with price and "Reserve" button.' },
      { name: 'Trips', prompt: 'My trips: upcoming trip card with countdown, itinerary timeline by day (flight, check-in, activities), documents, and past trips list. Bottom tab bar with Trips active.' },
      { name: 'Profile', prompt: 'Profile: avatar, traveler level, saved payment, preferences, notifications, help and log out. Bottom tab bar with Profile active.' },
      { name: 'Saved', prompt: 'Saved wishlists as collage cards (Summer 2026, Weekend getaways) and saved places grid. Bottom tab bar with Saved active.' },
    ],
    web: [],
  },
  {
    keys: /\b(education|learning|course|school|study|quiz|tutor|language)\b/i, category: 'education', name: 'Learnly',
    theme: T('friendly, focused, encouraging', '#7C3AED', '#F59E0B', '#FAFAFF', false, 'Nunito', 'Inter'),
    brief: 'Learnly is a learning app that keeps students motivated with bite-size lessons, streaks and clear progress, in a friendly, focused style.',
    nav: ['Home', 'Courses', 'Practice', 'Profile'],
    screens: [
      { name: 'Home', prompt: 'Learning home: greeting with streak flame 14 days and XP, "Continue learning" course card with progress bar, daily goal ring, recommended courses carousel, upcoming live class card. Bottom tab bar with Home active.' },
      { name: 'Courses', prompt: 'Course catalog with search, category chips, featured course banner, course cards (thumbnail, title, instructor, rating, lessons, level). Bottom tab bar with Courses active.' },
      { name: 'Lesson', prompt: 'Lesson player: video area, lesson title, progress through module, notes and transcript tabs, key takeaways, "Mark complete" and next lesson buttons.' },
      { name: 'Quiz', prompt: 'Quiz question screen: progress 4/10, timer, question text, four answer options with one selected, hint button, and "Check answer" button. Bottom tab bar with Practice active.' },
      { name: 'Profile', prompt: 'Profile: avatar, level, badges, certificates, weekly activity chart, settings and log out. Bottom tab bar with Profile active.' },
      { name: 'Leaderboard', prompt: 'Weekly leaderboard with top-3 podium, ranked list with avatars and XP, and the current user highlighted. Bottom tab bar with Practice active.' },
    ],
    web: [],
  },
];

const GENERIC: Template = {
  keys: /./, category: 'app', name: 'Nova',
  theme: T('modern, clean, confident', '#6366F1', '#EC4899', '#FFFFFF', false),
  brief: 'A modern, polished product with a clean interface, clear hierarchy and delightful details.',
  nav: ['Home', 'Explore', 'Activity', 'Profile'],
  screens: [
    { name: 'Home', prompt: 'Home dashboard: header with greeting and avatar, hero summary card with key metric, quick action buttons, content feed of cards with images, titles and meta info, and a highlights section. Bottom tab bar with Home active.' },
    { name: 'Explore', prompt: 'Explore: search bar, filter chips, featured banner, grid of content cards, and trending list. Bottom tab bar with Explore active.' },
    { name: 'Detail', prompt: 'Detail screen for a featured item: large image, title, rating, description, key attributes, related items, and a primary action button.' },
    { name: 'Activity', prompt: 'Activity and notifications: segmented tabs, grouped timeline of events with icons, timestamps and actions. Bottom tab bar with Activity active.' },
    { name: 'Profile', prompt: 'Profile and settings: avatar, stats, preferences list, notifications, privacy, help and log out. Bottom tab bar with Profile active.' },
    { name: 'Onboarding', prompt: 'Onboarding/welcome screen: illustration, headline, value proposition, page dots, "Get started" and "Sign in" buttons.' },
  ],
  web: [],
};

const WEB_PAGES: ScreenSpec[] = [
  { name: 'Home', prompt: 'Landing page: sticky header with logo, navigation and CTA button; hero with headline, sub-headline, primary/secondary CTAs and hero image; trust logos; 3-column features; testimonial section; pricing or offer highlight; final CTA band; footer with links, contact and social icons.' },
  { name: 'About', prompt: 'About page: header, story section with image, mission and values cards, team grid with photos and roles, milestones timeline, CTA band and footer.' },
  { name: 'Services', prompt: 'Services/Pricing page: header, intro, service or pricing cards with features and CTA, comparison table, FAQ accordion, CTA band and footer.' },
  { name: 'Contact', prompt: 'Contact page: header, contact form (name, email, message), contact details with icons, map, opening hours, FAQ snippet and footer.' },
  { name: 'Blog', prompt: 'Blog page: header, featured article hero, category filter, article cards grid with image, title, excerpt, author and date, newsletter signup and footer.' },
  { name: 'Gallery', prompt: 'Gallery/portfolio page: header, masonry grid of project images with captions and filters, case study highlight, CTA and footer.' },
];

/** Broad "make me an X app/website" request → full app. A specific screen/page stays single. */
export function looksLikeFullAppRequest(prompt: string) {
  const p = prompt.toLowerCase();
  const specific = /\b(screen|page|login|sign ?in|sign ?up|onboarding|checkout|cart|settings|profile|dashboard|detail|modal|form|landing)\b/.test(p);
  const broad = /\b(app|application|website|site|platform|startup|product)\b/.test(p);
  return broad && !specific && p.split(/\s+/).length <= 40;
}

function titleCase(s: string) { return s.replace(/\b\w/g, (m) => m.toUpperCase()); }

export function planBuiltIn(i: EnhanceInput): DesignPlan {
  const tpl = TEMPLATES.find((t) => t.keys.test(`${i.prompt} ${i.category ?? ''}`)) ?? GENERIC;
  const full = i.mode === 'app' || (i.mode === 'auto' && looksLikeFullAppRequest(i.prompt));
  const named = /(?:called|named)\s+["“]?([A-Z][\w\s&-]{1,30})/i.exec(i.prompt)?.[1]?.trim();
  const appName = named ? titleCase(named) : tpl.name;
  const pool = i.kind === 'website' ? WEB_PAGES : tpl.screens;
  let screens: ScreenSpec[];
  if (full && i.pageNames?.length) {
    screens = i.pageNames.slice(0, Math.max(1, i.maxScreens)).map((n) => {
      const known = pool.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? WEB_PAGES.find((s) => s.name.toLowerCase() === n.toLowerCase());
      return { name: n, prompt: known?.prompt ?? `${n} ${i.kind === 'website' ? 'page' : 'screen'} with the shared navigation, a clear heading, the content and components this ${i.kind === 'website' ? 'page' : 'screen'} needs with realistic sample data, and an obvious primary action.` };
    });
  } else if (full) screens = pool.slice(0, Math.max(1, i.maxScreens));
  else {
    // Single screen: the user's own prompt is the screen; template details only add direction.
    const match = i.pageName ? pool.find((s) => s.name.toLowerCase() === i.pageName!.toLowerCase()) : undefined;
    screens = [{ name: i.pageName || (looksLikeFullAppRequest(i.prompt) ? pool[0].name : 'Screen 1'), prompt: `${i.prompt.trim()}${match ? `\n\nSuggested structure: ${match.prompt}` : ''}` }];
  }
  const theme = i.style ? { ...tpl.theme, mood: `${i.style}; ${tpl.theme.mood}` } : tpl.theme;
  return {
    enhancer: 'built-in', appName, category: i.category || tpl.category, isFullApp: full && screens.length > 1, theme,
    designBrief: `${tpl.brief.replace(tpl.name, appName)} User request: "${i.prompt.trim().slice(0, 400)}".`,
    navigation: i.pageNames?.length && full ? i.pageNames.slice(0, 6) : i.kind === 'website' ? WEB_PAGES.slice(0, Math.max(4, Math.min(i.maxScreens, 6))).map((s) => s.name) : tpl.nav,
    screens,
  };
}

// ───────────────────────── Public API ─────────────────────────

export async function enhance(uid: string, i: EnhanceInput): Promise<DesignPlan> {
  const maxScreens = Math.min(Math.max(i.maxScreens, 1), 6);
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
    `Visual system: ${t.mood}. ${t.dark ? 'Dark' : 'Light'} theme. Background ${t.background}, primary ${t.primary}, accent ${t.accent}. Headings in ${t.headingFont}, body in ${t.bodyFont}. ${t.corners}. Consistent 4/8px spacing, WCAG AA contrast, realistic content (no lorem ipsum).`,
    plan.isFullApp && plan.screens.length > 1
      ? `This is ${unit} ${index + 1} of ${plan.screens.length} of the same product (${plan.screens.map((x) => x.name).join(', ')}). ${plan.navigation.length ? `Use the shared ${kind === 'website' ? 'header navigation' : 'bottom tab bar'}: ${plan.navigation.join(', ')}.` : ''} Keep every ${unit} visually consistent with the others.`
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
