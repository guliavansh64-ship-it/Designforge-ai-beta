import { fbAuth, firebaseConfigured, uiPreview } from './firebase';
import { previewGet } from './previewData';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public action?: string) { super(message); }
}

export async function idToken(force = false): Promise<string | undefined> {
  if (!firebaseConfigured) return undefined;
  return fbAuth().currentUser?.getIdToken(force);
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; retry?: boolean } = {}): Promise<T> {
  if (uiPreview) {
    if (method === 'GET') return previewGet(path) as T;
    throw new ApiError(400, 'UI_PREVIEW', 'UI preview mode: connect the backend (see README) to perform this action.');
  }
  const token = await idToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error — check your connection and try again.');
  }
  if (res.status === 401 && opts.retry !== false && token) {
    await idToken(true); // refresh once (expired session)
    return request<T>(method, path, body, { ...opts, retry: false });
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j?.error?.code ?? 'HTTP_' + res.status, j?.error?.message ?? res.statusText, j?.error?.action);
  }
  if (opts.raw) return res as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T,>(p: string, b?: unknown) => request<T>('DELETE', p, b),
  /** POST/GET that returns a file download. */
  async download(method: 'GET' | 'POST', path: string, body?: unknown, fallbackName = 'download.zip') {
    const res = await request<Response>(method, path, body, { raw: true });
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
    const report = res.headers.get('x-export-report');
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return report ? JSON.parse(atob(report)) : undefined;
  },
};

/** Appends a short-lived ID token for protected <img> assets served by the API. */
export async function assetUrl(url?: string) {
  if (!url) return undefined;
  if (!url.startsWith('/api/assets/')) return url;
  const t = await idToken();
  return `${BASE}${url}${t ? `?t=${encodeURIComponent(t)}` : ''}`;
}

export const newKey = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 32);
