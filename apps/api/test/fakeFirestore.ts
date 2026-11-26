/** Minimal in-memory Firestore supporting doc get/set/update/delete and serialised transactions. */
type Data = Record<string, any>;
export function createFakeDb() {
  const store = new Map<string, Data>();
  let lock: Promise<void> = Promise.resolve();
  const merge = (a: Data = {}, b: Data) => ({ ...a, ...b });
  const docRef = (path: string): any => ({
    id: path.split('/').pop(), path,
    async get() { const d = store.get(path); return { exists: !!d, id: path.split('/').pop(), data: () => (d ? { ...d } : undefined), get: (k: string) => d?.[k], ref: docRef(path) }; },
    async set(v: Data, o?: { merge?: boolean }) { store.set(path, o?.merge ? merge(store.get(path), v) : { ...v }); },
    async update(v: Data) { if (!store.has(path)) throw new Error('NOT_FOUND ' + path); store.set(path, merge(store.get(path), v)); },
    async delete() { store.delete(path); },
    collection: (c: string) => col(`${path}/${c}`),
  });
  let seq = 0;
  const col = (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`), async add(v: Data) { const r = docRef(`${name}/auto${++seq}`); await r.set(v); return r; } });
  const db = {
    collection: col,
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const prev = lock; let release!: () => void; lock = new Promise((r) => (release = r));
      await prev;
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, v: Data, o?: any) => writes.push(() => ref.set(v, o)),
        update: (ref: any, v: Data) => writes.push(() => ref.update(v)),
        delete: (ref: any) => writes.push(() => ref.delete()),
      };
      try { const r = await fn(tx); for (const w of writes) await w(); return r; } finally { release(); }
    },
  };
  return { db, store };
}
