import { describe, expect, it } from 'vitest';
import { safeQuery, isMissingIndex } from '../src/lib/safeQuery.js';

type Doc = { id: string; data: () => Record<string, unknown> };
/** Minimal Firestore Query fake: any orderBy or range filter "requires an index" (like an undeployed composite index). */
function fakeCol(rows: Record<string, unknown>[]) {
  const make = (filters: [string, string, unknown][], ordered: boolean, lim?: number): any => ({
    path: 'fake',
    where: (f: string, op: string, v: unknown) => make([...filters, [f, op, v]], ordered, lim),
    orderBy: () => make(filters, true, lim),
    limit: (n: number) => make(filters, ordered, n),
    limitToLast: (n: number) => make(filters, ordered, n),
    get: async () => {
      if (ordered || filters.some(([, op]) => op !== '==')) throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 });
      const docs: Doc[] = rows.filter((r) => filters.every(([f, , v]) => r[f] === v)).slice(0, lim).map((r) => ({ id: String(r.id), data: () => r }));
      return { docs, size: docs.length };
    },
  });
  return make([], false);
}

const rows = [
  { id: 'a', ownerId: 'u1', archived: false, updatedAt: 3, nameLower: 'alpha' },
  { id: 'b', ownerId: 'u1', archived: false, updatedAt: 9, nameLower: 'beta' },
  { id: 'c', ownerId: 'u1', archived: true, updatedAt: 5, nameLower: 'gamma' },
  { id: 'd', ownerId: 'u2', archived: false, updatedAt: 7, nameLower: 'delta' },
  { id: 'e', ownerId: 'u1', archived: false, updatedAt: 1, nameLower: 'alpine' },
];

describe('safeQuery (works before Firestore indexes are deployed)', () => {
  it('detects missing-index errors', () => {
    expect(isMissingIndex({ code: 9 })).toBe(true);
    expect(isMissingIndex(new Error('boom'))).toBe(false);
  });
  it('falls back to equality filters + in-memory order/limit', async () => {
    const docs = await safeQuery(fakeCol(rows), { where: [['ownerId', '==', 'u1'], ['archived', '==', false]], orderBy: ['updatedAt', 'desc'], limit: 2 });
    expect(docs.map((d) => d.id)).toEqual(['b', 'a']);
  });
  it('applies range filters, cursors and limitToLast in memory', async () => {
    const pre = await safeQuery(fakeCol(rows), { where: [['ownerId', '==', 'u1'], ['nameLower', '>=', 'al'], ['nameLower', '<=', 'al\uf8ff']], orderBy: ['nameLower', 'asc'] });
    expect(pre.map((d) => d.id)).toEqual(['a', 'e']);
    const page2 = await safeQuery(fakeCol(rows), { where: [['ownerId', '==', 'u1'], ['archived', '==', false]], orderBy: ['updatedAt', 'desc'], startAfterId: 'b', limit: 5 });
    expect(page2.map((d) => d.id)).toEqual(['a', 'e']);
    const last = await safeQuery(fakeCol(rows), { where: [['ownerId', '==', 'u1']], orderBy: ['updatedAt', 'asc'], limit: 2, limitToLast: true });
    expect(last.map((d) => d.id)).toEqual(['c', 'b']);
  });
  it('rethrows unrelated errors', async () => {
    const bad: any = { where: () => bad, orderBy: () => bad, limit: () => bad, get: async () => { throw new Error('PERMISSION_DENIED'); } };
    await expect(safeQuery(bad, { where: [['x', '==', 1]], orderBy: ['y', 'asc'] })).rejects.toThrow('PERMISSION_DENIED');
  });
});
