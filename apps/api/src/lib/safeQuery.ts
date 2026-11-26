import type { CollectionReference, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from './firebase.js';
import { logger } from './logger.js';

/**
 * Index-tolerant Firestore query.
 *
 * Runs the normal (composite-indexed) query first. If Firestore answers FAILED_PRECONDITION
 * ("The query requires an index"), because `firestore.indexes.json` hasn't been deployed yet
 * or an index is still building, it re-runs the query with ONLY the equality filters (served by
 * automatic single-field indexes / index merging, no composite index needed), then applies range
 * filters, ordering, cursor and limit in memory.
 *
 * Per-user collections are small, so the fallback is cheap. A capped read (`fallbackCap`) keeps it bounded.
 * Deploying the indexes (`firebase deploy --only firestore:indexes`) restores the fast path automatically.
 */
export type Op = '==' | '<' | '<=' | '>' | '>=' | 'array-contains';
export interface SafeQuerySpec {
  where?: [string, Op, unknown][];
  orderBy?: [string, 'asc' | 'desc'];
  limit?: number;
  /** Keep the LAST `limit` docs of the ordering (Firestore limitToLast). */
  limitToLast?: boolean;
  /** Document id to start after (pagination cursor, same collection). */
  startAfterId?: string;
  /** Max docs read by the fallback (default 1000). */
  fallbackCap?: number;
}

const warned = new Set<string>();

export function isMissingIndex(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; details?: unknown };
  return err?.code === 9 || /requires an index|index is currently building/i.test(String(err?.details ?? err?.message ?? ''));
}

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(v: unknown, op: Op, x: unknown): boolean {
  switch (op) {
    case '==': return v === x;
    case '<': return v !== undefined && v !== null && cmp(v, x) < 0;
    case '<=': return v !== undefined && v !== null && cmp(v, x) <= 0;
    case '>': return v !== undefined && v !== null && cmp(v, x) > 0;
    case '>=': return v !== undefined && v !== null && cmp(v, x) >= 0;
    case 'array-contains': return Array.isArray(v) && v.includes(x);
  }
}

export async function safeQuery(base: CollectionReference | Query, spec: SafeQuerySpec): Promise<QueryDocumentSnapshot[]> {
  const where = spec.where ?? [];
  // ── Fast path: the real indexed query.
  try {
    let q: Query = base;
    for (const [f, op, v] of where) q = q.where(f, op, v);
    if (spec.orderBy) q = q.orderBy(spec.orderBy[0], spec.orderBy[1]);
    if (spec.startAfterId && 'doc' in base) {
      const c = await (base as CollectionReference).doc(spec.startAfterId).get();
      if (c.exists) q = q.startAfter(c);
    }
    if (spec.limit) q = spec.limitToLast ? q.limitToLast(spec.limit) : q.limit(spec.limit);
    return (await q.get()).docs;
  } catch (e) {
    if (!isMissingIndex(e)) throw e;
    const key = `${(base as CollectionReference).path ?? 'query'}:${where.map((w) => w[0] + w[1]).join(',')}:${spec.orderBy?.join(' ') ?? ''}`;
    if (!warned.has(key)) {
      warned.add(key);
      logger.warn({ query: key }, 'Firestore composite index missing; serving from in-memory fallback. Run: firebase deploy --only firestore:indexes');
    }
  }
  // ── Fallback: equality filters only (array-contains alone also needs no composite index).
  const eq = where.filter(([, op]) => op === '==');
  const arr = where.filter(([, op]) => op === 'array-contains');
  let q: Query = base;
  for (const [f, , v] of eq) q = q.where(f, '==', v);
  if (!eq.length && arr.length === 1) q = q.where(arr[0][0], 'array-contains', arr[0][2]);
  const snap = await q.limit(spec.fallbackCap ?? 1000).get();
  let docs = snap.docs.filter((d) => where.every(([f, op, v]) => matches(get(d.data(), f), op, v)));
  if (spec.orderBy) {
    const [f, dir] = spec.orderBy;
    docs = docs.sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(get(a.data(), f), get(b.data(), f)));
  }
  if (spec.startAfterId) {
    const i = docs.findIndex((d) => d.id === spec.startAfterId);
    if (i >= 0) docs = docs.slice(i + 1);
  }
  if (spec.limit) docs = spec.limitToLast ? docs.slice(-spec.limit) : docs.slice(0, spec.limit);
  return docs;
}

/** Convenience for top-level collections. */
export const safeCollectionQuery = (collection: string, spec: SafeQuerySpec) => safeQuery(db().collection(collection), spec);
