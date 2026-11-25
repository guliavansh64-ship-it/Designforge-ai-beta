import crypto from 'node:crypto';
import { db, C } from '../lib/firebase.js';
import { Errors } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';

/**
 * Storage abstraction. Two interchangeable backends:
 *  - "cloudinary" (if CLOUDINARY_* env set): signed server-side upload, returns CDN URL.
 *  - "firestore" (default, zero extra services): binary chunked across docs in
 *    `project_assets/{id}/chunks/*`, served by GET /api/assets/:id with ownership checks.
 * Swap providers without touching callers.
 */
const CHUNK = 700_000; // stays under Firestore's 1 MiB document limit

export interface StoredBlob { id: string; url: string; mime: string; bytes: number; provider: 'cloudinary' | 'firestore' }

const cloud = () => {
  const { CLOUDINARY_CLOUD_NAME: n, CLOUDINARY_API_KEY: k, CLOUDINARY_API_SECRET: s } = process.env;
  return n && k && s ? { n, k, s } : undefined;
};

export async function putBlob(ownerId: string, data: Buffer, mime: string, meta: Record<string, unknown> = {}): Promise<StoredBlob> {
  const id = newId('as_');
  const cfg = cloud();
  if (cfg && mime.startsWith('image/')) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `designforge/${ownerId}`;
    const toSign = `folder=${folder}&public_id=${id}&timestamp=${timestamp}${cfg.s}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    const form = new FormData();
    form.set('file', `data:${mime};base64,${data.toString('base64')}`);
    form.set('api_key', cfg.k); form.set('timestamp', String(timestamp));
    form.set('folder', folder); form.set('public_id', id); form.set('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cfg.n}/image/upload`, { method: 'POST', body: form });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Cloudinary upload failed: ${j?.error?.message}`);
    await db().collection(C.assets).doc(id).set({ ownerId, mime, bytes: data.length, provider: 'cloudinary', url: j.secure_url, ...meta, createdAt: Date.now() });
    return { id, url: j.secure_url, mime, bytes: data.length, provider: 'cloudinary' };
  }
  const ref = db().collection(C.assets).doc(id);
  const batch = db().batch();
  const n = Math.ceil(data.length / CHUNK);
  batch.set(ref, { ownerId, mime, bytes: data.length, chunks: n, provider: 'firestore', ...meta, createdAt: Date.now() });
  for (let i = 0; i < n; i++) batch.set(ref.collection('chunks').doc(String(i).padStart(4, '0')), { d: data.subarray(i * CHUNK, (i + 1) * CHUNK) });
  await batch.commit();
  return { id, url: `/api/assets/${id}`, mime, bytes: data.length, provider: 'firestore' };
}

export async function getBlob(id: string, uid: string | undefined, allowPublic = false): Promise<{ data: Buffer; mime: string } | { redirect: string }> {
  const ref = db().collection(C.assets).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Errors.notFound('Asset');
  const d = snap.data()!;
  if (d.ownerId !== uid && !(allowPublic && d.public === true)) throw Errors.notFound('Asset');
  if (d.provider === 'cloudinary') return { redirect: d.url };
  const chunks = await ref.collection('chunks').orderBy('__name__').get();
  return { data: Buffer.concat(chunks.docs.map((c) => Buffer.from(c.get('d')))), mime: d.mime };
}

export async function deleteBlob(id: string) {
  const ref = db().collection(C.assets).doc(id);
  const chunks = await ref.collection('chunks').get();
  const batch = db().batch();
  chunks.docs.forEach((c) => batch.delete(c.ref));
  batch.delete(ref);
  await batch.commit();
}

/** Downloads a remote image (e.g. Stitch screenshot URL which may expire) and persists it. */
export async function persistRemoteImage(ownerId: string, url: string, meta: Record<string, unknown> = {}): Promise<string | undefined> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return undefined;
    const mime = r.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    if (!mime.startsWith('image/')) return undefined;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8_000_000) return undefined;
    return (await putBlob(ownerId, buf, mime, meta)).url;
  } catch {
    return undefined;
  }
}
