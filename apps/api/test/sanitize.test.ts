import { describe, expect, it } from 'vitest';
import { sanitizeSavedHtml } from '../src/services/sanitize.js';

const stitchLike = `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<script>tailwind.config={theme:{extend:{colors:{primary:"#7c5cff"}}}}</script></head>
<body class="bg-white"><h1 class="text-4xl" data-df-sel="">Hello</h1><a href="/pricing">Pricing</a></body></html>`;

describe('sanitizeSavedHtml', () => {
  it('keeps generated-design essentials (Tailwind runtime + inline config) intact', () => {
    const { html, report } = sanitizeSavedHtml(stitchLike);
    expect(html).toContain('https://cdn.tailwindcss.com?plugins=forms');
    expect(html).toContain('tailwind.config=');
    expect(html).toContain('href="/pricing"');
    expect(html).not.toContain('data-df-sel');
    expect(report.removed).toEqual([]);
    expect(html.startsWith('<!doctype html>') || html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
  it('removes external scripts, frames, handlers, javascript: URLs, base and meta refresh', () => {
    const evil = `<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">
<script src="https://evil.example/x.js"></script><script src="//cdn.tailwindcss.com.evil.example/t.js"></script></head>
<body><img src="x" onerror="alert(1)"><a href=" java\tscript:alert(1)">x</a><iframe src="https://evil.example"></iframe>
<object data="x.swf"></object><button ONCLICK="steal()">b</button><form action="javascript:alert(1)"></form></body></html>`;
    const { html, report } = sanitizeSavedHtml(evil);
    for (const bad of ['evil.example', 'onerror', 'onclick', 'ONCLICK', 'javascript', 'java\tscript', '<iframe', '<object', '<base', 'refresh']) expect(html).not.toContain(bad);
    expect(html).toContain('<img src="x"');
    expect(report.removed.length).toBeGreaterThanOrEqual(8);
  });
});
