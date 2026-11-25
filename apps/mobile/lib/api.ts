import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fbAuth, firebaseConfigured } from './firebase';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public action?: string) { super(message); }
}
export async function idToken(force = false) {
  if (!firebaseConfigured) return undefined;
  return fbAuth().currentUser?.getIdToken(force);
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'CONFIG', 'EXPO_PUBLIC_API_URL is not set.');
  const token = await idToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-client': 'android' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && retry && token) { await idToken(true); return request<T>(method, path, body, false); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j?.error?.code ?? `HTTP_${res.status}`, j?.error?.message ?? 'Request failed', j?.error?.action);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T,>(p: string, b?: unknown) => request<T>('DELETE', p, b),
  /** Downloads a ZIP (export / brand kit) to app storage and opens the Android share sheet. */
  async downloadAndShare(method: 'GET' | 'POST', path: string, body: unknown, filename: string) {
    const token = await idToken();
    const target = `${FileSystem.cacheDirectory}${filename.replace(/[^a-z0-9._-]/gi, '_')}`;
    if (method === 'GET') {
      const r = await FileSystem.downloadAsync(`${API_URL}/api${path}`, target, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (r.status >= 400) throw new ApiError(r.status, 'DOWNLOAD_FAILED', 'Download failed');
    } else {
      const res = await fetch(`${API_URL}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
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
  return `${API_URL}${url}${t ? `?t=${encodeURIComponent(t)}` : ''}`;
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
