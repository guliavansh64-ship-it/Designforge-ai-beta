import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, peekCache } from './api';
import type { Job } from './types';

/**
 * GET hook with stale-while-revalidate: shows cached data immediately (no skeleton flash when you
 * revisit a screen), refreshes in the background, and ignores responses for a path that is no longer current.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(() => (path ? peekCache<T>(path) ?? null : null));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path && peekCache(path) === undefined);
  const current = useRef(path); current.current = path;
  const load = useCallback(async () => {
    if (!path) return;
    const cached = peekCache<T>(path);
    if (cached !== undefined) setData(cached); else setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (current.current === path) { setData(d); setError(null); }
    } catch (e) { if (current.current === path) setError(e as ApiError); } finally { if (current.current === path) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Polls GET /api/jobs/:id with backoff until terminal. Push notification also arrives when backgrounded. */
export function useJob(jobId: string | null, onDone?: (j: Job, sawRunning: boolean) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    let stop = false; let delay = 1500; let t: ReturnType<typeof setTimeout>; let live = false;
    const tick = async () => {
      try {
        const { job: j } = await api.get<{ job: Job }>(`/jobs/${jobId}`);
        if (stop) return;
        // PERF: only re-render when something visible changed (polling every few seconds otherwise
        // re-rendered the whole project screen, incl. the WebView preview).
        setJob((prev) => (prev && prev.id === j.id && prev.status === j.status && prev.progress === j.progress && prev.stage === j.stage && prev.error?.message === j.error?.message && prev.screensDone === j.screensDone && prev.screenNames?.length === j.screenNames?.length && prev.warnings?.length === j.warnings?.length ? prev : j));
        if (['succeeded', 'failed', 'cancelled'].includes(j.status)) { cb.current?.(j, live); return; }
        live = true;
      } catch { /* keep polling */ }
      delay = Math.min(delay * 1.3, 6000); t = setTimeout(tick, delay);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [jobId]);
  return job;
}

export const timeAgo = (t?: number) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
