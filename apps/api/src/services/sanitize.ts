import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Sanitises HTML saved by users from the visual editor (and shared editors) before it is stored/exported.
 * Generated designs legitimately use inline <script> (e.g. `tailwind.config = {...}`) and the Tailwind
 * runtime, so we keep inline scripts + allow-listed script hosts, and remove the dangerous rest.
 * Defence in depth: previews additionally run in an opaque-origin sandbox with connect-src 'none'.
 */
const SCRIPT_HOSTS = ['cdn.tailwindcss.com'];
const DROP_TAGS = ['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'portal'];
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data'];

export interface SanitizeReport { removed: string[] }

export function sanitizeSavedHtml(html: string): { html: string; report: SanitizeReport } {
  const removed: string[] = [];
  const root = parse(html, { comment: true, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  for (const t of DROP_TAGS) root.querySelectorAll(t).forEach((el) => { removed.push(`<${t}>`); el.remove(); });
  root.querySelectorAll('script').forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return; // inline config scripts are part of generated designs
    let host = '';
    try { host = new URL(src, 'https://invalid.local').hostname; } catch { /* malformed */ }
    if (!SCRIPT_HOSTS.includes(host)) { removed.push(`<script src=${src.slice(0, 80)}>`); el.remove(); }
  });
  root.querySelectorAll('meta').forEach((el) => {
    if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') { removed.push('<meta refresh>'); el.remove(); }
  });
  (root.querySelectorAll('*') as HTMLElement[]).forEach((el) => {
    for (const name of Object.keys(el.attributes)) {
      const lower = name.toLowerCase();
      const value = el.getAttribute(name) ?? '';
      if (lower.startsWith('on')) { removed.push(`${lower}=`); el.removeAttribute(name); continue; }
      if (lower.startsWith('data-df-')) { el.removeAttribute(name); continue; } // editor artefacts
      if (URL_ATTRS.includes(lower) && /^\s*(javascript|vbscript|data:text\/html)/i.test(value.replace(/[\u0000-\u001F\s]+/g, ''))) {
        removed.push(`${lower}=javascript:`); el.removeAttribute(name);
      }
    }
  });
  const out = root.toString();
  return { html: /^\s*<!doctype/i.test(out) ? out : `<!doctype html>\n${out.replace(/^\s*<!doctype[^>]*>/i, '')}`, report: { removed } };
}
