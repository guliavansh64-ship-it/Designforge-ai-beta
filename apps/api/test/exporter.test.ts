import { describe, expect, it } from 'vitest';
import { parse } from 'node-html-parser';
import { buildHtmlExport, buildReactExport, htmlNodeToJsx, validateTsx, zipFiles } from '../src/services/exporter.js';
import { renderTemplate, TEMPLATE_SPECS } from '../src/scripts/templates.js';

const STITCH_LIKE = `<!DOCTYPE html><html class="light" lang="en"><head><meta charset="utf-8"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet"/>
<script id="tailwind-config">tailwind.config = { darkMode: "class", theme: { extend: { colors: { primary: "#1173d4" } } } }</script>
<style>.material-symbols-outlined{font-variation-settings:'FILL' 0}</style></head>
<body class="bg-white font-display"><header id="top" class="flex p-4"><h1 class="text-2xl">Acme {Dash}</h1>
<input type="checkbox" checked class="form-checkbox"/><label for="q">Search</label><input id="q" value="x" tabindex="1"/></header>
<main><section style="background-color: #fff; --tw-x: 1"><svg viewBox="0 0 24 24" stroke-width="2"><path d="M0 0"></path></svg>
<button onclick="alert(1)">Go</button><img src="/logo.png" alt="logo"><br></section></main></body></html>`;

describe('HTML → JSX', () => {
  it('converts attributes, styles, void tags, braces and strips handlers', () => {
    const jsx = htmlNodeToJsx(parse(STITCH_LIKE).querySelector('body')!);
    expect(jsx).toContain('className="flex p-4"');
    expect(jsx).toContain('htmlFor="q"');
    expect(jsx).toContain('tabIndex={1}');
    expect(jsx).toContain('defaultValue="x"');
    expect(jsx).toContain('defaultChecked');
    expect(jsx).toContain('strokeWidth="2"');
    expect(jsx).toContain('viewBox="0 0 24 24"');
    expect(jsx).toContain(`style={{ backgroundColor: "#fff", "--tw-x": "1" } as CSSProperties}`);
    expect(jsx).toContain("Acme {'{'}Dash{'}'}");
    expect(jsx).toContain('<br />');
    expect(jsx).not.toContain('onclick');
  });
});

describe('React export', () => {
  it('produces a valid Vite+TS project that passes TypeScript syntax validation', async () => {
    const { files, report } = await buildReactExport('Acme Dashboard', [{ name: 'Home', html: STITCH_LIKE }, { name: 'Pricing page', html: renderTemplate(TEMPLATE_SPECS[0]) }]);
    expect(report.errors).toEqual([]);
    for (const f of ['package.json', 'tsconfig.json', 'vite.config.ts', 'tailwind.config.js', 'index.html', 'src/main.tsx', 'src/App.tsx', 'README.md', 'src/pages/HomePage.tsx', 'src/pages/PricingPagePage.tsx']) expect(files[f], f).toBeDefined();
    expect(String(files['tailwind.config.js'])).toContain('#1173d4');
    expect(String(files['src/App.tsx'])).toContain('path="/pricing-page"');
    expect(String(files['index.html'])).toContain('fonts.googleapis.com');
    expect(JSON.stringify(files)).not.toMatch(/AIza[0-9A-Za-z_-]{20}|rzp_(live|test)_|-----BEGIN/);
  });
  it('maps <option selected> to <select defaultValue> (React-correct)', () => {
    const jsx = htmlNodeToJsx(parse('<select><option value="a">A</option><option value="b" selected>B</option></select>').firstChild!);
    expect(jsx).toContain('<select defaultValue="b">');
    expect(jsx).not.toContain('selected');
  });
  it('validator catches broken TSX', () => {
    expect(validateTsx({ 'src/x.tsx': 'export default () => (<div>)' }).length).toBeGreaterThan(0);
  });
});

describe('HTML export', () => {
  it('extracts CSS/JS, keeps Tailwind config, writes README and zips', async () => {
    const { files, report } = await buildHtmlExport('Acme', [{ name: 'Home', html: STITCH_LIKE }, { name: 'About Us', html: renderTemplate(TEMPLATE_SPECS[1]) }]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['index.html', 'about-us.html', 'css/styles.css', 'js/main.js', 'README.md']));
    expect(String(files['index.html'])).toContain('css/styles.css');
    expect(String(files['index.html'])).toContain('tailwind.config');
    expect(String(files['css/styles.css'])).toContain('material-symbols-outlined');
    expect(report.warnings.join()).toMatch(/Tailwind Play CDN/);
    const zip = await zipFiles(files, 'acme');
    expect(zip.subarray(0, 2).toString()).toBe('PK');
  });
});
