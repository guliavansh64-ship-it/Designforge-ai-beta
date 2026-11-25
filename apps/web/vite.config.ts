import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** Strict CSP for the SPA document, injected at BUILD time only (dev needs inline HMR preamble). */
function appCsp(apiBase: string): Plugin {
  let apiOrigin = '';
  try { if (/^https?:/.test(apiBase)) apiOrigin = new URL(apiBase).origin; } catch { /* relative */ }
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://apis.google.com https://www.gstatic.com https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://*.googleapis.com https://api.razorpay.com https://lumberjack.razorpay.com ${apiOrigin}`.trim(),
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://api.razorpay.com https://checkout.razorpay.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
  ].join('; ');
  return {
    name: 'designforge-csp', apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), appCsp(env.VITE_API_BASE || '')],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      // Browser code always calls relative /api; dev server proxies to the API.
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8080', changeOrigin: true } },
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
