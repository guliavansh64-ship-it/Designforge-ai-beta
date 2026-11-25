import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { GenerationJob } from './types';

/** Simple data hook with loading/error and manual reload. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api.get<T>(path)); setError(null); } catch (e) { setError(e as ApiError); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Polls a generation job until it reaches a terminal state. Backs off to save free-tier reads. */
export function useJob(jobId: string | null, onDone?: (job: GenerationJob) => void) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    let stop = false; let delay = 1500; let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job: j } = await api.get<{ job: GenerationJob }>(`/jobs/${jobId}`);
        if (stop) return;
        setJob(j);
        if (['succeeded', 'failed', 'cancelled'].includes(j.status)) { done.current?.(j); return; }
      } catch { /* transient network issue → keep polling */ }
      delay = Math.min(delay * 1.25, 5000);
      t = setTimeout(tick, delay);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [jobId]);
  return job;
}

export function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const timeAgo = (t?: number) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString('en-IN');
};
export const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
