import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser';
import ts from 'typescript';

/**
 * Export Center engine.
 *  - HTML export: per-page index files, extracted CSS/JS, downloaded image assets, README.
 *  - React export: Vite + React + TypeScript + Tailwind project; each top-level section
 *    becomes a typed component; pages are routed with react-router.
 *  - Validation: every generated .tsx/.ts file is parsed with the TypeScript compiler;
 *    syntax errors block the export and are reported with file + line.
 *    (A full `npm install && vite build` is not run server-side on the free tier —
 *    documented in docs/09-TESTING.md; CI template included in the export.)
 */

export interface ExportPage { name: string; html: string }
export type FileMap = Record<string, string | Buffer>;
export interface ExportReport { files: number; assetsDownloaded: number; assetsFailed: string[]; warnings: string[]; errors: string[] }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
const pascal = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/^[0-9]/, 'S$&') || 'Section';

const ATTR_MAP: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength',
  colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete', autofocus: 'autoFocus', crossorigin: 'crossOrigin',
  srcset: 'srcSet', enctype: 'encType', novalidate: 'noValidate', contenteditable: 'contentEditable', spellcheck: 'spellCheck',
  frameborder: 'frameBorder', allowfullscreen: 'allowFullScreen', datetime: 'dateTime', 'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv', autoplay: 'autoPlay', playsinline: 'playsInline', srcdoc: 'srcDoc', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint', referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority', formaction: 'formAction', usemap: 'useMap', cellpadding: 'cellPadding', cellspacing: 'cellSpacing', viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace',
};
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BOOL = new Set(['disabled', 'multiple', 'required', 'hidden', 'autoFocus', 'readOnly', 'noValidate', 'allowFullScreen', 'open', 'autoPlay', 'playsInline', 'loop', 'muted', 'controls', 'defer', 'async', 'reversed', 'inert']);
const NUMERIC = new Set(['tabIndex', 'colSpan', 'rowSpan', 'maxLength', 'minLength', 'cols', 'rows', 'size', 'span', 'start']);

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleToObject(style: string): string {
  const entries = style.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return null;
    const k = d.slice(0, i).trim(); const v = d.slice(i + 1).trim();
    const key = k.startsWith('--') ? JSON.stringify(k) : camel(k.toLowerCase());
    return `${key}: ${JSON.stringify(v)}`;
  }).filter(Boolean);
  const hasCustom = entries.some((e) => e!.startsWith('"--'));
  return hasCustom ? `{{ ${entries.join(', ')} } as CSSProperties}` : `{{ ${entries.join(', ')} }}`;
}

function escapeJsxText(t: string) {
  return t.replace(/[{}<>]/g, (c) => `{'${c}'}`);
}

export function htmlNodeToJsx(node: Node, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (node instanceof TextNode) {
    const raw = node.rawText;
    if (!raw.trim()) return '';
    return pad + escapeJsxText(raw.replace(/\s+/g, ' ').trim());
  }
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.rawTagName?.toLowerCase();
  if (!tag || tag === 'script' || tag === 'style') return '';
  const attrs = Object.entries(node.attributes)
    .filter(([k]) => !/^on[a-z]+$/i.test(k)) // strip inline handlers (unsafe + invalid in React)
    .filter(([k]) => !(tag === 'option' && k.toLowerCase() === 'selected')) // React: selection lives on <select defaultValue>
    .map(([k, v]) => {
      const lk = k.toLowerCase();
      let name = ATTR_MAP[lk] ?? (lk.startsWith('data-') || lk.startsWith('aria-') ? lk : lk.includes('-') || lk.includes(':') ? camel(lk.replace(':', '-')) : k);
      if (lk === 'style') return `style=${styleToObject(v)}`;
      // Uncontrolled form state so exported components render without React warnings.
      if (lk === 'value' && tag !== 'option' && tag !== 'button') name = 'defaultValue';
      if (lk === 'checked') name = 'defaultChecked';
      if (BOOL.has(name) || name === 'defaultChecked') {
        if (v === '' || v.toLowerCase() === lk || v === 'true') return name;
        if (v === 'false') return `${name}={false}`;
      }
      if (NUMERIC.has(name) && /^-?\d+$/.test(v)) return `${name}={${v}}`;
      return `${name}=${JSON.stringify(v)}`;
    });
  if (tag === 'select' && !('value' in node.attributes)) {
    const sel = node.querySelectorAll('option').find((o) => o.hasAttribute('selected'));
    if (sel) attrs.push(`defaultValue=${JSON.stringify(sel.getAttribute('value') ?? sel.text.trim())}`);
  }
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(tag)) return `${pad}${open} />`;
  const children = node.childNodes.map((c) => htmlNodeToJsx(c, indent + 1)).filter(Boolean);
  if (!children.length) return `${pad}${open}></${tag}>`;
  return `${pad}${open}>\n${children.join('\n')}\n${pad}</${tag}>`;
}

export function validateTsx(files: FileMap): string[] {
  const errors: string[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(file) || typeof content !== 'string') continue;
    const out = ts.transpileModule(content, {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    });
    for (const d of out.diagnostics ?? []) {
      const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      errors.push(`${file}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ''} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    }
  }
  return errors;
}

async function downloadAssets(root: HTMLElement, assetDir: string, prefix: string, files: FileMap, report: ExportReport, cache: Map<string, string>) {
  const imgs = root.querySelectorAll('img[src]');
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src')!;
    if (!/^https:\/\//.test(src)) return;
    if (cache.has(src)) { img.setAttribute('src', prefix + cache.get(src)); return; }
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(20_000) });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('image/')) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 6_000_000) throw new Error('too large');
      const ext = type.includes('svg') ? 'svg' : type.includes('webp') ? 'webp' : type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg';
      const name = `${assetDir}/img-${cache.size + 1}.${ext}`;
      cache.set(src, name);
      files[name] = buf;
      img.setAttribute('src', prefix + name);
      report.assetsDownloaded++;
    } catch (e) {
      report.assetsFailed.push(`${src.slice(0, 80)} (${(e as Error).message}) — kept remote URL`);
    }
  }));
}

function extractTailwindConfig(root: HTMLElement): string | undefined {
  for (const s of root.querySelectorAll('script')) {
    const m = /tailwind\.config\s*=\s*(\{[\s\S]*\})\s*;?\s*$/m.exec(s.text.trim());
    if (m) return m[1];
  }
}

export async function buildHtmlExport(projectName: string, pages: ExportPage[]): Promise<{ files: FileMap; report: ExportReport }> {
  const files: FileMap = {};
  const report: ExportReport = { files: 0, assetsDownloaded: 0, assetsFailed: [], warnings: [], errors: [] };
  const cache = new Map<string, string>();
  const allCss: string[] = []; const allJs: string[] = [];
  const nav = pages.map((p, i) => ({ name: p.name, file: i === 0 ? 'index.html' : `${slug(p.name)}.html` }));
  for (const [i, page] of pages.entries()) {
    const root = parse(page.html, { comment: false, blockTextElements: { script: true, style: true } });
    root.querySelectorAll('style').forEach((s) => { allCss.push(`/* ${page.name} */\n${s.text}`); s.remove(); });
    root.querySelectorAll('script:not([src])').forEach((s) => {
      if (/tailwind\.config/.test(s.text)) return; // keep Tailwind runtime config inline (required by CDN runtime)
      allJs.push(`// ${page.name}\n${s.text}`); s.remove();
    });
    await downloadAssets(root, 'assets', '', files, report, cache);
    const head = root.querySelector('head');
    if (head) {
      head.insertAdjacentHTML('beforeend', '\n<link rel="stylesheet" href="css/styles.css">');
      if (!root.querySelector('meta[name="viewport"]')) head.insertAdjacentHTML('afterbegin', '<meta name="viewport" content="width=device-width, initial-scale=1">');
    }
    const body = root.querySelector('body');
    body?.insertAdjacentHTML('beforeend', '\n<script src="js/main.js" defer></script>');
    if (root.querySelector('script[src*="cdn.tailwindcss.com"]')) report.warnings.push(`${page.name}: uses the Tailwind Play CDN runtime. For production, compile Tailwind (see README).`);
    files[nav[i].file] = '<!doctype html>\n' + root.toString().replace(/^<!doctype html>/i, '').trim();
  }
  files['css/styles.css'] = allCss.join('\n\n') || '/* DesignForge: no custom CSS */\n';
  files['js/main.js'] = allJs.join('\n\n') || '// DesignForge: no custom scripts\n';
  files['README.md'] = `# ${projectName}\n\nExported from DesignForge AI.\n\n## Pages\n${nav.map((n) => `- [${n.name}](${n.file})`).join('\n')}\n\n## Run\nOpen \`index.html\` in a browser, or serve the folder:\n\n\`\`\`bash\nnpx serve .\n\`\`\`\n\n## Notes\n${report.warnings.map((w) => `- ${w}`).join('\n') || '- No warnings.'}\n${report.assetsFailed.length ? `\n### Assets kept as remote URLs\n${report.assetsFailed.map((a) => `- ${a}`).join('\n')}\n` : ''}`;
  report.files = Object.keys(files).length;
  return { files, report };
}

export async function buildReactExport(projectName: string, pages: ExportPage[]): Promise<{ files: FileMap; report: ExportReport }> {
  const files: FileMap = {};
  const report: ExportReport = { files: 0, assetsDownloaded: 0, assetsFailed: [], warnings: [], errors: [] };
  const cache = new Map<string, string>();
  const pkgName = slug(projectName);
  let twConfig: string | undefined;
  const fontLinks = new Set<string>();
  const extraCss: string[] = [];
  const routes: { path: string; comp: string; name: string }[] = [];

  for (const [i, page] of pages.entries()) {
    const root = parse(page.html, { comment: false, blockTextElements: { script: true, style: true } });
    twConfig ??= extractTailwindConfig(root);
    root.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach((l) => fontLinks.add(l.getAttribute('href')!));
    root.querySelectorAll('style').forEach((s) => extraCss.push(`/* ${page.name} */\n${s.text}`));
    await downloadAssets(root, 'public/assets', '/', files, report, cache);
    root.querySelectorAll('img[src^="/public/"]').forEach((img) => img.setAttribute('src', img.getAttribute('src')!.replace('/public/', '/')));

    const body = root.querySelector('body') ?? root;
    const pageComp = pascal(page.name) + 'Page';
    const sections = body.childNodes.filter((n) => n instanceof HTMLElement && !['script', 'style'].includes((n as HTMLElement).rawTagName?.toLowerCase())) as HTMLElement[];
    const imports: string[] = []; const uses: string[] = [];
    const used = new Set<string>();
    for (const [si, sec] of sections.entries()) {
      const label = sec.getAttribute('id') || sec.getAttribute('aria-label') || sec.querySelector('h1,h2')?.text.slice(0, 24) || sec.rawTagName;
      let comp = pascal(label ?? `Section ${si + 1}`);
      if (/^(Header|Nav|Footer|Main|Section|Div)$/.test(comp)) comp = comp + 'Block';
      while (used.has(comp)) comp += si + 1;
      used.add(comp);
      const jsx = htmlNodeToJsx(sec, 2);
      const typeImport = jsx.includes('as CSSProperties') ? `import type { CSSProperties } from 'react';\n\n` : '';
      files[`src/components/${pascal(page.name)}/${comp}.tsx`] = `${typeImport}export default function ${comp}() {\n  return (\n${jsx}\n  );\n}\n`;
      imports.push(`import ${comp} from '../components/${pascal(page.name)}/${comp}';`);
      uses.push(`      <${comp} />`);
    }
    const bodyClass = body.getAttribute?.('class');
    files[`src/pages/${pageComp}.tsx`] = `${imports.join('\n')}\n\nexport default function ${pageComp}() {\n  return (\n    <div${bodyClass ? ` className=${JSON.stringify(bodyClass)}` : ''}>\n${uses.join('\n')}\n    </div>\n  );\n}\n`;
    routes.push({ path: i === 0 ? '/' : `/${slug(page.name)}`, comp: pageComp, name: page.name });
  }

  files['package.json'] = JSON.stringify({
    name: pkgName, private: true, version: '1.0.0', type: 'module',
    scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.28.0' },
    devDependencies: {
      '@types/react': '^18.3.12', '@types/react-dom': '^18.3.1', '@vitejs/plugin-react': '^4.3.3',
      autoprefixer: '^10.4.20', postcss: '^8.4.49', tailwindcss: '^3.4.15', '@tailwindcss/forms': '^0.5.9', '@tailwindcss/container-queries': '^0.1.1',
      typescript: '^5.6.3', vite: '^5.4.11',
    },
  }, null, 2);
  files['tsconfig.json'] = JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, isolatedModules: true }, include: ['src'] }, null, 2);
  files['vite.config.ts'] = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n`;
  files['postcss.config.js'] = `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;
  const cfg = twConfig ? twConfig.replace(/^\{/, `{\n  content: ['./index.html', './src/**/*.{ts,tsx}'],`) : `{\n  content: ['./index.html', './src/**/*.{ts,tsx}'],\n  theme: { extend: {} },\n}`;
  files['tailwind.config.js'] = `/** Generated from the design's Tailwind runtime config. */\nimport forms from '@tailwindcss/forms';\nimport containerQueries from '@tailwindcss/container-queries';\n\nconst config = ${cfg};\nconfig.plugins = [...(config.plugins || []).filter((p) => typeof p !== 'string'), forms, containerQueries];\nexport default config;\n`;
  files['index.html'] = `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${projectName.replace(/</g, '')}</title>\n${[...fontLinks].map((h) => `    <link rel="stylesheet" href="${h.replace(/"/g, '&quot;')}" />`).join('\n')}\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`;
  files['src/index.css'] = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${extraCss.join('\n\n')}\n`;
  files['src/main.tsx'] = `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { BrowserRouter } from 'react-router-dom';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>,\n);\n`;
  files['src/App.tsx'] = `import { Routes, Route } from 'react-router-dom';\n${routes.map((r) => `import ${r.comp} from './pages/${r.comp}';`).join('\n')}\n\nexport default function App() {\n  return (\n    <Routes>\n${routes.map((r) => `      <Route path="${r.path}" element={<${r.comp} />} />`).join('\n')}\n    </Routes>\n  );\n}\n`;
  files['.gitignore'] = 'node_modules\ndist\n.env\n';
  files['.github/workflows/build.yml'] = `name: build\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm install\n      - run: npm run build\n`;
  files['README.md'] = `# ${projectName}\n\nReact + TypeScript + Tailwind project exported from DesignForge AI.\n\n## Setup\n\`\`\`bash\nnpm install\nnpm run dev      # http://localhost:5173\nnpm run build    # production build in dist/\n\`\`\`\n\n## Structure\n- \`src/pages/*\` — one component per designed page (routes: ${routes.map((r) => `\`${r.path}\``).join(', ')})\n- \`src/components/<Page>/*\` — one component per top-level section\n- \`public/assets\` — downloaded images\n\nNo secrets or API keys are included.\n`;

  report.errors = validateTsx(files);
  report.files = Object.keys(files).length;
  return { files, report };
}

export function zipFiles(files: FileMap, rootDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.pipe(out);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name: `${rootDir}/${name}` });
    archive.finalize();
  });
}
