/**
 * Reads an existing generated screen to work out the app's "shape": the tab-bar labels and the main
 * colours / fonts. Used by "Complete this app" so the new screens match the existing one and every
 * tab in the bottom bar gets a real screen (which is what makes Play mode navigate everywhere).
 */

const ICON_SPAN = /<(span|i)\b[^>]*class="[^"]*(material-symbols|material-icons|icon)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;

function textOf(html: string) {
  return html.replace(ICON_SPAN, ' ').replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ').replace(TAG, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function itemsIn(block: string): string[] {
  const out: string[] = [];
  const re = /<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const t = textOf(m[2]);
    if (t && t.length <= 20 && t.split(' ').length <= 3 && !/^\d/.test(t)) out.push(t);
  }
  return out;
}

/** Bottom tab bar (apps) or header links (websites). Returns 2–6 short labels, or [] when none found. */
export function extractNavLabels(html: string): string[] {
  if (!html) return [];
  const candidates: string[] = [];
  const navs = html.match(/<nav\b[\s\S]*?<\/nav>/gi) ?? [];
  // The LAST <nav> is usually the bottom tab bar on mobile screens.
  for (const n of [...navs].reverse()) candidates.push(n);
  // Fallback: a fixed bottom container.
  const fixed = html.match(/<(div|footer)\b[^>]*class="[^"]*(fixed|sticky)[^"]*bottom-0[^"]*"[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  candidates.push(...fixed);
  for (const block of candidates) {
    const seen = new Set<string>();
    const items = itemsIn(block).filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (items.length >= 2 && items.length <= 6) return items;
  }
  return [];
}

/** Most used colours + font families, as a short style hint for Stitch. */
export function extractStyleHint(html: string): string {
  if (!html) return '';
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const c = `#${m[1].toLowerCase()}`;
    if (c === '#ffffff' || c === '#000000') continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const fonts = new Set<string>();
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"&:]+)/gi)) fonts.add(decodeURIComponent(m[1]).replace(/\+/g, ' '));
  for (const m of html.matchAll(/font-family:\s*['"]?([A-Za-z][\w ]+)/gi)) if (fonts.size < 3) fonts.add(m[1].trim());
  for (const f of [...fonts]) if (/material|icon|symbol/i.test(f)) fonts.delete(f);
  const dark = /class="[^"]*\bdark\b/.test(html) || /bg-(gray|slate|zinc|neutral)-9\d\d/.test(html);
  return [
    colors.length ? `exact colours ${colors.join(', ')}` : '',
    fonts.size ? `fonts ${[...fonts].slice(0, 2).join(' and ')}` : '',
    dark ? 'dark theme' : '',
  ].filter(Boolean).join('; ');
}

/** "Complete app" wording: the user explicitly wants every screen, not one. */
export const EXPLICIT_FULL_APP = /\b(complete|full|entire|whole)\s+(?:[\w-]+\s+){0,3}?(app|application|website|site|product)\b|\b(all|every)\s+(?:the\s+)?(screens|pages|sections)\b|\bmulti[- ]?(screen|page)\b/i;

export interface ModeInput { hasDesigns: boolean; targetHasDesign: boolean; newPageName?: string; completeApp?: boolean; requested?: 'auto' | 'single' | 'app'; prompt: string; affordable: number }
/**
 * single = one screen; app = a complete app (every screen); auto = the planner decides from the prompt.
 * An EMPTY first page (every new project has one) never forces single — that was the old bug.
 */
export function chooseGenerateMode(i: ModeInput): { mode: 'single' | 'auto' | 'app'; error?: 'needs_design' | 'needs_two' } {
  if (i.completeApp) return i.hasDesigns ? { mode: 'app' } : { mode: 'app', error: 'needs_design' };
  if (i.hasDesigns || i.targetHasDesign || i.newPageName || i.requested === 'single') return { mode: 'single' };
  if (i.requested === 'app' || EXPLICIT_FULL_APP.test(i.prompt)) return i.affordable >= 2 ? { mode: 'app' } : { mode: 'app', error: 'needs_two' };
  return { mode: i.affordable >= 2 ? 'auto' : 'single' };
}

/** Visible text of a screen (no icons/scripts), trimmed — tells the planner what the app is about. */
export function screenSummary(html: string, max = 600): string {
  return textOf(html).slice(0, max);
}
