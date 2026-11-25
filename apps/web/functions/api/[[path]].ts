/**
 * Cloudflare Pages Function: same-origin proxy  /api/*  →  ${API_ORIGIN}/api/*
 * Lets the web app use relative /api URLs (no CORS, strict CSP connect-src 'self').
 * Set API_ORIGIN (e.g. https://designforge-api.onrender.com) in Pages → Settings → Environment variables.
 * Generation is asynchronous (202 + polling), so requests here are short and fit Pages' limits.
 */
interface Env { API_ORIGIN: string }
export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.API_ORIGIN) return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'API_ORIGIN not configured' } }), { status: 500, headers: { 'content-type': 'application/json' } });
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('cookie'); // API is bearer-token only
  headers.set('x-forwarded-host', url.host);
  const init: RequestInit = { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' };
  // @ts-expect-error duplex is required by the Workers runtime for streaming bodies
  init.duplex = 'half';
  return fetch(target, init);
};
