import { parse, type HTMLElement } from 'node-html-parser';
import type { AuditCheck, ProjectKind, QualityAudit } from '@designforge/shared';

/**
 * DesignForge Heuristic Design Audit
 * ----------------------------------
 * Deterministic, explainable checks run against generated HTML. The score is the
 * severity-weighted share of checks that pass (high=3, medium=2, low=1).
 * It is a DesignForge-internal heuristic — NOT an industry standard, and it can't
 * judge aesthetics. Contrast is only measured where colours are statically resolvable.
 */
export const AUDIT_METHODOLOGY =
  'Severity-weighted percentage of DesignForge automated heuristics that pass (high=3, medium=2, low=1). ' +
  'Checks cover structure, accessibility, typography, colour, spacing, responsiveness and code hygiene. ' +
  'It is not an industry-standard score and does not measure visual taste.';

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;

// Tailwind default palette subset for contrast resolution of common utility classes.
const TW: Record<string, string> = {
  white: '#ffffff', black: '#000000',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  'zinc-100': '#f4f4f5', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a', 'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',
  'neutral-100': '#f5f5f5', 'neutral-400': '#a3a3a3', 'neutral-500': '#737373', 'neutral-800': '#262626', 'neutral-900': '#171717',
};

export function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [l1, l2] = [lum(ra), lum(rb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function styleProp(el: HTMLElement, prop: string): string | undefined {
  const s = el.getAttribute('style');
  if (!s) return;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(s);
  return m?.[1]?.trim();
}

function twColor(el: HTMLElement, prefix: 'text' | 'bg'): string | undefined {
  const cls = (el.getAttribute('class') ?? '').split(/\s+/);
  for (const c of cls) {
    if (c.includes(':')) continue; // ignore variants (hover:, dark:, md:)
    const arb = new RegExp(`^${prefix}-\\[(#[0-9a-fA-F]{3,6})\\]$`).exec(c);
    if (arb) return arb[1];
    if (c.startsWith(prefix + '-') && TW[c.slice(prefix.length + 1)]) return TW[c.slice(prefix.length + 1)];
  }
}

function resolvedBg(el: HTMLElement | null): string | undefined {
  let cur: HTMLElement | null = el;
  while (cur && cur.tagName) {
    const bg = styleProp(cur, 'background-color') ?? styleProp(cur, 'background') ?? twColor(cur, 'bg');
    if (bg && /^#/.test(bg)) return bg;
    cur = cur.parentNode as HTMLElement | null;
  }
  return undefined;
}

const EXPECTED_SECTIONS: Record<ProjectKind, { key: string; label: string; pattern: RegExp }[]> = {
  website: [
    { key: 'nav', label: 'navigation header', pattern: /<nav|<header/i },
    { key: 'hero', label: 'hero section', pattern: /hero|<h1/i },
    { key: 'cta', label: 'call-to-action', pattern: /get started|sign up|contact|book|buy|try|start/i },
    { key: 'footer', label: 'footer', pattern: /<footer/i },
  ],
  ui: [
    { key: 'heading', label: 'screen title', pattern: /<h1|<h2/i },
    { key: 'action', label: 'primary action', pattern: /<button|role="button"/i },
  ],
  improve: [{ key: 'heading', label: 'screen title', pattern: /<h1|<h2/i }],
  logo: [],
};

export function auditHtml(html: string, kind: ProjectKind = 'ui', device: string = 'DESKTOP'): QualityAudit {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  const checks: AuditCheck[] = [];
  const add = (c: AuditCheck) => checks.push(c);
  const all = root.querySelectorAll('*');
  const css = root.querySelectorAll('style').map((s) => s.text).join('\n') + '\n' + all.map((e) => e.getAttribute('style') ?? '').join(';');
  const classes = all.flatMap((e) => (e.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));

  // ── Structure
  add({ id: 'title', category: 'structure', label: 'Document has a <title>', severity: 'low',
    passed: !!root.querySelector('title')?.text.trim(), detail: 'Titles identify the page in tabs, bookmarks and search.',
    fixInstruction: 'Add a descriptive page title.' });
  const landmarks = ['main', 'header', 'footer', 'nav'].filter((t) => root.querySelector(t));
  add({ id: 'landmarks', category: 'structure', label: 'Uses semantic landmarks', severity: 'medium',
    passed: !!root.querySelector('main') || landmarks.length >= 2, detail: `Found: ${landmarks.join(', ') || 'none'}.`,
    fixInstruction: 'Wrap primary content in <main> and use semantic <header>, <nav> and <footer> elements.' });
  for (const s of EXPECTED_SECTIONS[kind] ?? []) {
    add({ id: `section_${s.key}`, category: 'structure', label: `Includes a ${s.label}`, severity: 'medium',
      passed: s.pattern.test(html), detail: `Expected for a ${kind} design.`, fixInstruction: `Add a clear ${s.label}.` });
  }

  // ── Visual hierarchy
  const h1s = root.querySelectorAll('h1').length;
  add({ id: 'single_h1', category: 'hierarchy', label: 'Exactly one primary heading (h1)', severity: 'high',
    passed: h1s === 1, detail: `Found ${h1s} h1 element(s).`,
    fixInstruction: h1s === 0 ? 'Add one clear, prominent primary heading.' : 'Keep a single primary heading; demote others to h2/h3.' });
  const levels = root.querySelectorAll('h1,h2,h3,h4,h5,h6').map((h) => Number(h.tagName[1]));
  let skipped = false;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skipped = true;
  add({ id: 'heading_order', category: 'hierarchy', label: 'Heading levels are not skipped', severity: 'medium',
    passed: !skipped && levels.length > 0, detail: levels.length ? `Sequence: ${levels.slice(0, 12).join(' → ')}` : 'No headings found.',
    fixInstruction: 'Use a logical heading hierarchy (h1 → h2 → h3) to strengthen visual hierarchy.' });

  // ── Accessibility
  add({ id: 'lang', category: 'accessibility', label: '<html lang> is set', severity: 'low',
    passed: !!root.querySelector('html')?.getAttribute('lang'), detail: 'Screen readers rely on lang for pronunciation.',
    fixInstruction: 'Set the document language.' });
  const imgs = root.querySelectorAll('img');
  const noAlt = imgs.filter((i) => i.getAttribute('alt') === undefined).length;
  add({ id: 'img_alt', category: 'accessibility', label: 'Images have alt text', severity: 'high',
    passed: noAlt === 0, detail: `${noAlt} of ${imgs.length} images missing alt.`, fixInstruction: 'Give every meaningful image descriptive alt text.' });
  const interactive = root.querySelectorAll('button, a');
  const unlabeled = interactive.filter((el) => !el.text.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')).length;
  add({ id: 'control_names', category: 'accessibility', label: 'Buttons & links have accessible names', severity: 'high',
    passed: unlabeled === 0, detail: `${unlabeled} icon-only control(s) without label.`, fixInstruction: 'Add visible text or aria-labels to icon-only buttons and links.' });
  const inputs = root.querySelectorAll('input:not([type=hidden]), select, textarea');
  const unlabeledInputs = inputs.filter((i) => {
    const id = i.getAttribute('id');
    return !i.getAttribute('aria-label') && !i.getAttribute('placeholder') && !(id && root.querySelector(`label[for="${id}"]`)) && i.closest('label') === null;
  }).length;
  add({ id: 'form_labels', category: 'accessibility', label: 'Form fields are labelled', severity: 'medium',
    passed: unlabeledInputs === 0, detail: `${unlabeledInputs} of ${inputs.length} fields lack a label.`, fixInstruction: 'Associate every form field with a visible label.' });

  // ── Contrast (only statically resolvable pairs)
  let measured = 0; const failing: string[] = [];
  for (const el of all) {
    if (!el.text.trim() || el.childNodes.some((c) => (c as HTMLElement).tagName)) continue; // leaf text only
    const fg = styleProp(el, 'color') ?? twColor(el, 'text');
    if (!fg || !fg.startsWith('#')) continue;
    const bg = resolvedBg(el) ?? '#ffffff';
    const r = contrastRatio(fg, bg);
    if (r === null) continue;
    measured++;
    if (r < 4.5) failing.push(`"${el.text.trim().slice(0, 24)}" ${r.toFixed(2)}:1`);
    if (measured > 400) break;
  }
  add({ id: 'contrast', category: 'contrast', label: 'Text contrast ≥ 4.5:1 (WCAG AA, where measurable)', severity: 'high',
    passed: failing.length === 0, detail: measured ? `${measured} text nodes measured; ${failing.length} below 4.5:1${failing.length ? ` e.g. ${failing.slice(0, 3).join('; ')}` : ''}.` : 'No statically resolvable colour pairs (not measured).',
    fixInstruction: 'Increase text/background contrast to at least 4.5:1 for body text.' });

  // ── Typography
  const fontFamilies = new Set<string>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) fontFamilies.add(m[1].split(',')[0].replace(/["']/g, '').trim().toLowerCase());
  for (const l of root.querySelectorAll('link[href*="fonts.googleapis.com"]')) {
    for (const m of (l.getAttribute('href') ?? '').matchAll(/family=([^:&]+)/g)) fontFamilies.add(decodeURIComponent(m[1]).replace(/\+/g, ' ').toLowerCase());
  }
  fontFamilies.delete('material symbols outlined'); fontFamilies.delete('material icons'); fontFamilies.delete('inherit');
  add({ id: 'font_count', category: 'typography', label: 'At most 3 typefaces', severity: 'medium',
    passed: fontFamilies.size <= 3, detail: `Typefaces: ${[...fontFamilies].join(', ') || 'system default'}.`, fixInstruction: 'Limit typography to a heading face and a body face.' });
  const tinyText = [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].filter((m) => Number(m[1]) < 12).length
    + classes.filter((c) => /^text-\[(\d+)px\]$/.test(c) && Number(/\d+/.exec(c)![0]) < 12).length;
  add({ id: 'min_font', category: 'typography', label: 'No body text below 12px', severity: 'medium',
    passed: tinyText === 0, detail: `${tinyText} declarations under 12px.`, fixInstruction: 'Raise minimum text size to 12px (14–16px for body copy).' });

  // ── Colour consistency
  const colors = new Set<string>();
  for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) colors.add(m[0].toLowerCase());
  for (const c of classes) { const m = /^(?:text|bg|border)-\[(#[0-9a-fA-F]{3,6})\]$/.exec(c); if (m) colors.add(m[1].toLowerCase()); }
  add({ id: 'palette_size', category: 'color', label: 'Cohesive colour palette (≤ 12 distinct hex colours)', severity: 'low',
    passed: colors.size <= 12, detail: `${colors.size} distinct hex colours.`, fixInstruction: 'Consolidate colours into a defined palette of primary, neutral and accent tokens.' });

  // ── Spacing
  const spacing = new Set(classes.filter((c) => /^-?(p|m)[trblxy]?-(\d+(\.\d+)?|\[.+\])$/.test(c)).map((c) => c.replace(/^-?(p|m)[trblxy]?-/, '')));
  const pxSpacing = new Set([...css.matchAll(/(?:margin|padding)[a-z-]*\s*:\s*([^;]+)/gi)].flatMap((m) => m[1].match(/\d+px/g) ?? []));
  const scale = spacing.size + pxSpacing.size;
  add({ id: 'spacing_scale', category: 'spacing', label: 'Consistent spacing scale (≤ 10 distinct steps)', severity: 'low',
    passed: scale <= 10, detail: `${scale} distinct spacing values.`, fixInstruction: 'Use a consistent 4/8px spacing scale across sections.' });

  // ── Responsive
  const hasViewport = !!root.querySelector('meta[name="viewport"]');
  add({ id: 'viewport', category: 'responsive', label: 'Has responsive viewport meta', severity: 'high',
    passed: hasViewport, detail: hasViewport ? 'Present.' : 'Missing.', fixInstruction: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
  const bp = classes.filter((c) => /^(sm|md|lg|xl|2xl):/.test(c)).length + (css.match(/@media/g)?.length ?? 0);
  if (device !== 'MOBILE') {
    add({ id: 'breakpoints', category: 'responsive', label: 'Adapts layout across breakpoints', severity: 'medium',
      passed: bp >= 3, detail: `${bp} responsive rules/utilities.`, fixInstruction: 'Make the layout adapt to mobile, tablet and desktop widths with responsive breakpoints.' });
  }
  const fixedWide = [...css.matchAll(/(?:^|[;{\s])width\s*:\s*(\d+)px/gi)].filter((m) => Number(m[1]) > 640).length
    + classes.filter((c) => /^w-\[(\d+)px\]$/.test(c) && Number(/\d+/.exec(c)![0]) > 640).length;
  add({ id: 'fixed_width', category: 'responsive', label: 'No fixed widths wider than 640px', severity: 'medium',
    passed: fixedWide === 0, detail: `${fixedWide} fixed-width declarations > 640px.`, fixInstruction: 'Replace large fixed widths with fluid widths and max-width containers.' });

  // ── Navigation
  if (kind === 'website') {
    const navLinks = root.querySelectorAll('nav a, header a').length;
    add({ id: 'nav_links', category: 'navigation', label: 'Navigation has 3–8 links', severity: 'medium',
      passed: navLinks >= 3 && navLinks <= 8, detail: `${navLinks} links in header/nav.`, fixInstruction: 'Provide a clear primary navigation with 3–8 items.' });
  }
  const deadLinks = root.querySelectorAll('a').filter((a) => !a.getAttribute('href')).length;
  add({ id: 'dead_links', category: 'navigation', label: 'Links have destinations', severity: 'low',
    passed: deadLinks === 0, detail: `${deadLinks} anchors without href.`, fixInstruction: 'Give every link a destination or convert it to a button.' });

  // ── Code hygiene
  const inlineHandlers = all.filter((e) => Object.keys(e.attributes).some((a) => /^on[a-z]+$/i.test(a))).length;
  add({ id: 'inline_handlers', category: 'code', label: 'No inline event handlers', severity: 'low',
    passed: inlineHandlers === 0, detail: `${inlineHandlers} inline on* attributes.`, fixInstruction: 'Avoid inline JavaScript handlers.' });
  const externalScripts = root.querySelectorAll('script[src]').map((s) => s.getAttribute('src') ?? '').filter((s) => !/cdn\.tailwindcss\.com/.test(s));
  add({ id: 'external_scripts', category: 'code', label: 'No unexpected third-party scripts', severity: 'medium',
    passed: externalScripts.length === 0, detail: externalScripts.length ? externalScripts.slice(0, 3).join(', ') : 'Only Tailwind runtime (if any).',
    fixInstruction: 'Remove unnecessary third-party scripts.' });

  const total = checks.reduce((s, c) => s + WEIGHT[c.severity], 0);
  const passed = checks.filter((c) => c.passed).reduce((s, c) => s + WEIGHT[c.severity], 0);
  return { score: total ? Math.round((passed / total) * 100) : 0, checks, measuredAt: Date.now(), methodology: AUDIT_METHODOLOGY };
}

/** Builds a Stitch edit instruction from failed checks + user guidance (Stage 5). */
export function buildImprovementPlan(audit: QualityAudit, userInstructions?: string, maxItems = 8) {
  const order = { high: 0, medium: 1, low: 2 } as const;
  const items = audit.checks
    .filter((c) => !c.passed && c.fixInstruction)
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, maxItems);
  const lines = items.map((c, i) => `${i + 1}. ${c.fixInstruction}`);
  const prompt = [
    'Improve this existing screen while preserving its content, brand and overall layout intent.',
    lines.length ? 'Apply these specific fixes:\n' + lines.join('\n') : 'Refine visual polish: hierarchy, spacing rhythm and contrast.',
    userInstructions?.trim() ? `Also follow the user's direction: ${userInstructions.trim()}` : '',
    'Keep it fully responsive and accessible.',
  ].filter(Boolean).join('\n\n');
  return { items, prompt };
}

export function compareAudits(before: QualityAudit, after: QualityAudit) {
  const b = new Map(before.checks.map((c) => [c.id, c.passed]));
  const fixed = after.checks.filter((c) => c.passed && b.get(c.id) === false).map((c) => c.label);
  const regressed = after.checks.filter((c) => !c.passed && b.get(c.id) === true).map((c) => c.label);
  return { scoreDelta: after.score - before.score, fixed, regressed };
}

/** Stage 1: enrich a raw prompt with structural requirements for the chosen kind. */
export function enrichPrompt(prompt: string, kind: ProjectKind, opts: { category?: string; pages?: string[]; style?: string } = {}) {
  const parts = [prompt.trim()];
  if (kind === 'website') {
    parts.push(`This is a ${opts.category ?? 'business'} website${opts.pages?.length ? ` page ("${opts.pages[0]}")` : ''}. Include a sticky header with clear navigation, a strong hero with a primary call-to-action, well-structured content sections, and a footer with contact and links.`);
  }
  if (opts.style) parts.push(`Visual style: ${opts.style}.`);
  parts.push('Use a consistent spacing scale, at most two typefaces, WCAG AA contrast, semantic HTML landmarks, and alt text on images.');
  // Stitch's agent otherwise tends to reply with a multi-screen plan + question instead of a design.
  parts.push('Generate exactly one screen now (the main screen). Do not ask clarifying questions or propose a plan first: make sensible assumptions for anything unspecified.');
  return parts.join('\n\n');
}
