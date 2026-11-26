import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fbAuth, firebaseConfigured } from './firebase';

import * as SecureStore from 'expo-secure-store';

const BUILD_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
/** Test builds only (EXPO_PUBLIC_ALLOW_API_OVERRIDE=1): the server URL can be changed in-app. */
export const API_OVERRIDE_ALLOWED = process.env.EXPO_PUBLIC_ALLOW_API_OVERRIDE === '1';
const OVERRIDE_KEY = 'df_api_url_override';
/** Remembers which built-in URL the override was saved under, so an app update with a new server drops stale overrides. */
const OVERRIDE_BASE_KEY = 'df_api_url_override_base';
let apiUrl = BUILD_API_URL;
const listeners = new Set<(u: string) => void>();

export const getApiUrl = () => apiUrl;
export const getBuildApiUrl = () => BUILD_API_URL;
export function onApiUrlChange(fn: (u: string) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Must run before the first API call (AuthProvider awaits it). No-op in production builds. */
export async function loadApiUrlOverride() {
  if (!API_OVERRIDE_ALLOWED) return;
  const [saved, savedBase] = await Promise.all([
    SecureStore.getItemAsync(OVERRIDE_KEY).catch(() => null),
    SecureStore.getItemAsync(OVERRIDE_BASE_KEY).catch(() => null),
  ]);
  if (!saved) return;
  if (savedBase !== BUILD_API_URL) {
    // Saved under an older build (e.g. a temporary tunnel URL). The new built-in server wins.
    await SecureStore.deleteItemAsync(OVERRIDE_KEY).catch(() => undefined);
    return;
  }
  apiUrl = saved; listeners.forEach((l) => l(apiUrl));
}

/** Normalises + validates a server URL and checks that /health answers like a DesignForge API. */
export async function testApiUrl(raw: string): Promise<string> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Enter a full URL, e.g. https://my-api.onrender.com'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL must start with https:// (or http:// on your local Wi-Fi)');
  if (u.username || u.password || u.search || u.hash) throw new Error('URL must not contain credentials, ? or #');
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60_000); // Render free tier cold start
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(`Server answered ${r.status} but it is not a DesignForge API`);
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'No answer within 60 s' : (e as Error).message.includes('DesignForge') ? (e as Error).message : `Could not reach ${base}/health`);
  } finally { clearTimeout(t); }
  return base;
}

export async function setApiUrlOverride(base: string | null) {
  if (!API_OVERRIDE_ALLOWED) return;
  if (base) { await SecureStore.setItemAsync(OVERRIDE_KEY, base); await SecureStore.setItemAsync(OVERRIDE_BASE_KEY, BUILD_API_URL); }
  else await SecureStore.deleteItemAsync(OVERRIDE_KEY);
  apiUrl = base ?? BUILD_API_URL;
  cache.clear();
  listeners.forEach((l) => l(apiUrl));
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public action?: string) { super(message); }
}
export async function idToken(force = false) {
  if (!firebaseConfigured) return undefined;
  return fbAuth().currentUser?.getIdToken(force);
}

// ── Slow-request tracking: lets the UI show "Waking up the server…" while Render's free tier cold-starts.
let pending = 0; let slowTimer: ReturnType<typeof setTimeout> | null = null; let slow = false;
const slowListeners = new Set<(slow: boolean) => void>();
const setSlow = (v: boolean) => { if (slow !== v) { slow = v; slowListeners.forEach((l) => l(v)); } };
export function onServerSlow(l: (slow: boolean) => void) { slowListeners.add(l); l(slow); return () => { slowListeners.delete(l); }; }
function trackStart() { pending++; if (!slowTimer) slowTimer = setTimeout(() => setSlow(true), 3500); }
function trackEnd() { pending = Math.max(0, pending - 1); if (pending === 0) { if (slowTimer) clearTimeout(slowTimer); slowTimer = null; setSlow(false); } }

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  if (!apiUrl) throw new ApiError(0, 'CONFIG', 'No server URL is set.');
  const token = await idToken();
  let res: Response;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90_000); // covers a Render cold start
  trackStart();
  try {
    res = await fetch(`${apiUrl}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-client': 'android' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', ctrl.signal.aborted ? 'The server took too long to respond. Please try again.' : 'No connection. Check your internet and try again.');
  } finally { clearTimeout(timer); trackEnd(); }
  if (res.status === 401 && retry && token) { await idToken(true); return request<T>(method, path, body, false); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j?.error?.code ?? `HTTP_${res.status}`, j?.error?.message ?? 'Request failed', j?.error?.action);
  }
  return res.json() as Promise<T>;
}

// ── GET cache (stale-while-revalidate) + in-flight de-duplication. Screens paint cached data instantly
// and refresh in the background; any mutation clears the cache so nothing stale lingers.
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
export const peekCache = <T,>(path: string) => cache.get(path)?.data as T | undefined;
export const clearApiCache = () => cache.clear();
function cachedGet<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = request<T>('GET', path)
    .then((d) => { cache.set(path, { data: d, at: Date.now() }); return d; })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}
const mutate = <T,>(method: string, p: string, b?: unknown) => request<T>(method, p, b).finally(clearApiCache);

export const api = {
  get: <T,>(p: string) => cachedGet<T>(p),
  post: <T,>(p: string, b?: unknown) => mutate<T>('POST', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => mutate<T>('PATCH', p, b ?? {}),
  del: <T,>(p: string, b?: unknown) => mutate<T>('DELETE', p, b),
  /** Downloads a ZIP (export / brand kit) to app storage and opens the Android share sheet. */
  async downloadAndShare(method: 'GET' | 'POST', path: string, body: unknown, filename: string) {
    const token = await idToken();
    const target = `${FileSystem.cacheDirectory}${filename.replace(/[^a-z0-9._-]/gi, '_')}`;
    if (method === 'GET') {
      const r = await FileSystem.downloadAsync(`${apiUrl}/api${path}`, target, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (r.status >= 400) throw new ApiError(r.status, 'DOWNLOAD_FAILED', 'Download failed');
    } else {
      const res = await fetch(`${apiUrl}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j?.error?.code ?? 'EXPORT_FAILED', j?.error?.message ?? 'Export failed', j?.error?.action); }
      const buf = await res.arrayBuffer();
      await FileSystem.writeAsStringAsync(target, toBase64(new Uint8Array(buf)), { encoding: FileSystem.EncodingType.Base64 });
    }
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { mimeType: 'application/zip', dialogTitle: filename });
    return target;
  },
};

export async function assetUrl(url?: string) {
  if (!url) return undefined;
  if (!url.startsWith('/api/assets/')) return url;
  const t = await idToken();
  return `${apiUrl}${url}${t ? `?t=${encodeURIComponent(t)}` : ''}`;
}

export const newKey = () => Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('') + Date.now().toString(36);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return out;
}
