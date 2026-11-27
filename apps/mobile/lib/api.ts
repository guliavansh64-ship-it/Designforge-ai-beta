import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Power } from '../modules/designo-power';
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

/** Normalises + validates a server URL and checks that /health answers like a Designo API. */
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
    if (!r.ok || !j?.ok) throw new Error(`Server answered ${r.status} but it is not a Designo API`);
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'No answer within 60 s' : (e as Error).message.includes('Designo') ? (e as Error).message : `Could not reach ${base}/health`);
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
export const clearApiCache = () => { cache.clear(); schedulePersist(); };

// The GET cache is also saved on the phone, so lists and projects appear INSTANTLY on the next app launch
// (then refresh in the background) instead of waiting for the server.
const PERSIST_KEY = 'api-cache-v1';
const PERSIST_MAX = 900_000; // stay far below Android's AsyncStorage row limit
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const out: Record<string, { data: unknown; at: number }> = {}; let size = 0;
    for (const [k, v] of [...cache.entries()].sort((a, b) => b[1].at - a[1].at)) {
      if (k.startsWith('/jobs/') || k.startsWith('/admin')) continue;
      const len = JSON.stringify(v.data)?.length ?? 0;
      if (len > 250_000 || size + len > PERSIST_MAX) continue;
      out[k] = v; size += len;
    }
    AsyncStorage.setItem(PERSIST_KEY, JSON.stringify(out)).catch(() => undefined);
  }, 1500);
}
export const cacheHydrated: Promise<void> = AsyncStorage.getItem(PERSIST_KEY).then((raw) => {
  if (!raw) return;
  const saved = JSON.parse(raw) as Record<string, { data: unknown; at: number }>;
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const [k, v] of Object.entries(saved)) if (v.at > weekAgo && !cache.has(k)) cache.set(k, v);
}).catch(() => undefined);
/** Signing out must not leave the previous account's data on the phone. */
export const wipeApiCache = () => { cache.clear(); AsyncStorage.removeItem(PERSIST_KEY).catch(() => undefined); };

/** Wake the server the moment the app opens (before sign-in finishes), so the first real request is fast. */
export function warmUpServer() {
  if (!apiUrl) return;
  fetch(`${apiUrl}/health`).catch(() => undefined);
}
setTimeout(warmUpServer, 0);
function cachedGet<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = request<T>('GET', path)
    .then((d) => { cache.set(path, { data: d, at: Date.now() }); schedulePersist(); return d; })
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
  /**
   * Downloads a file and SAVES it to the phone's Downloads/Designo folder (no share sheet).
   * Falls back to the share sheet only on Android 9 and older, where direct saving isn't possible.
   * Resolves to where it went: { saved: true, uri } or { saved: false } (shared).
   */
  async download(method: 'GET' | 'POST', path: string, body: unknown, filename: string, mimeType = 'application/zip'): Promise<{ saved: boolean; uri?: string; name: string }> {
    const token = await idToken();
    const name = filename.replace(/[^a-z0-9._-]+/gi, '_').replace(/_+/g, '_');
    const target = `${FileSystem.cacheDirectory}${Date.now()}-${name}`;
    trackStart();
    try {
      if (method === 'GET') {
        const r = await FileSystem.downloadAsync(`${apiUrl}/api${path}`, target, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (r.status >= 400) {
          const txt = await FileSystem.readAsStringAsync(target).catch(() => '');
          await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
          let j: any = {}; try { j = JSON.parse(txt); } catch { /* not JSON */ }
          throw new ApiError(r.status, j?.error?.code ?? 'DOWNLOAD_FAILED', j?.error?.message ?? 'Download failed', j?.error?.action);
        }
      } else {
        const res = await fetch(`${apiUrl}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j?.error?.code ?? 'EXPORT_FAILED', j?.error?.message ?? 'Export failed', j?.error?.action); }
        const buf = await res.arrayBuffer();
        await FileSystem.writeAsStringAsync(target, toBase64(new Uint8Array(buf)), { encoding: FileSystem.EncodingType.Base64 });
      }
    } finally { trackEnd(); }
    if (Power?.saveToDownloads) {
      try {
        const uri = await Power.saveToDownloads(target, name, mimeType);
        FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
        return { saved: true, uri, name };
      } catch { /* Android 9 or older → share sheet below */ }
    }
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { mimeType, dialogTitle: name });
    return { saved: false, name };
  },
  /** Older call sites: same as download(). */
  async downloadAndShare(method: 'GET' | 'POST', path: string, body: unknown, filename: string, mimeType = 'application/zip') {
    return api.download(method, path, body, filename, mimeType);
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
