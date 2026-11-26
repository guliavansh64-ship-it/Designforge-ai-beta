import { motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, XCircle, Ban, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { GenerationJob } from '../lib/types';
import { Button, Card, Progress, cx } from './ui';

/** The 9 stages of the Auto Design Improvement engine (shown as an honest live checklist). */
export const IMPROVE_STAGES = [
  'Import / read current design',
  'Analyse structure & content',
  'Inspect hierarchy & typography',
  'Inspect spacing, contrast & responsiveness',
  'Build an improvement plan',
  'Send targeted fixes to Stitch',
  'Receive the improved screen',
  'Re-audit & compare before → after',
  'Final result ready',
];

function stageIndex(job: GenerationJob) {
  const s = job.stage ?? '';
  if (job.status === 'succeeded') return 9;
  const m = /Stage (\d)(?:–(\d))?/.exec(s);
  if (m) return Number(m[2] ?? m[1]) - (job.status === 'running' ? 1 : 0);
  if (/Creating Stitch project/.test(s)) return 0;
  return Math.floor((job.progress / 100) * 9);
}

export interface ImproveStep { iteration: number; before: number; after: number; scoreDelta: number; fixed: string[]; regressed: string[]; plan: string[]; fromVersionId: string; toVersionId: string }

export function JobProgress({ job, onClose, compact }: { job: GenerationJob; onClose?: () => void; compact?: boolean }) {
  const toast = useToast();
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(job.status);
  const cancel = async () => {
    try { await api.post(`/jobs/${job.id}/cancel`); toast('info', 'Cancellation requested. Credits for unfinished work are refunded automatically.'); }
    catch (e: any) { toast('error', e.message); }
  };
  const history = ((job as any).improvementHistory ?? []) as ImproveStep[];
  const idx = stageIndex(job);

  return (
    <Card className={cx('p-5', compact && 'p-4')}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {job.status === 'succeeded' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : job.status === 'failed' ? <XCircle className="h-5 w-5 text-red-500" /> : job.status === 'cancelled' ? <Ban className="h-5 w-5 muted" /> : <Loader2 className="h-5 w-5 animate-spin text-forge-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium capitalize">{job.type} · {job.status}</p>
            <span className="muted text-xs">{job.screensTotal && job.screensTotal > 1 ? `${job.screensDone ?? 0}/${job.screensTotal} screens · ${job.creditsReserved} credits per screen` : `${job.creditsReserved} credits reserved`}{job.status === 'failed' || job.status === 'cancelled' ? ' · refunded' : ''}</span>
          </div>
          <p className="muted mt-0.5 truncate text-sm">{job.stage}</p>
          {!terminal && <Progress value={job.progress} className="mt-3" />}
          {job.status === 'running' && job.progress >= 20 && job.progress < 85 && <p className="muted mt-2 text-xs">Stitch generations typically take 30–120 seconds. You can leave this page — you'll get a notification.</p>}
          {(job as any).screenNames?.length > 1 && job.type === 'generate' && <div className="mt-3 space-y-1 rounded-xl border border-ink-200 p-3 text-xs dark:border-ink-800">{((job as any).screenNames as string[]).map((n, i) => { const d = job.screensDone ?? 0; return <p key={n + i} className={i < d ? 'text-emerald-500' : i === d && !terminal ? 'font-semibold text-forge-500' : 'muted'}>{i < d ? '✓' : i === d && !terminal ? '●' : '○'} {i + 1}. {n}</p>; })}</div>}
          {job.warnings?.map((w, i) => <p key={i} className="mt-2 text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
          {job.error && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{job.error.message}</p>}
        </div>
      </div>

      {job.type === 'improve' && !compact && (
        <ol className="mt-5 grid gap-1.5 sm:grid-cols-3">
          {IMPROVE_STAGES.map((s, i) => {
            const done = i < idx; const active = i === idx && !terminal;
            return (
              <li key={s} className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs', active && 'bg-forge-500/10')}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-forge-400" /> : <Circle className="h-3.5 w-3.5 muted" />}
                <span className={cx(done ? '' : 'muted')}>{i + 1}. {s}</span>
              </li>
            );
          })}
        </ol>
      )}

      {history.length > 0 && !compact && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide muted">Iterations (DesignForge heuristic score)</p>
          {history.map((h) => (
            <motion.div key={h.iteration} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="surface-2 rounded-xl p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">Iteration {h.iteration}: {h.before} <ArrowRight className="h-3.5 w-3.5" /> {h.after}
                <span className={cx('text-xs', h.scoreDelta > 0 ? 'text-emerald-500' : h.scoreDelta < 0 ? 'text-red-500' : 'muted')}>({h.scoreDelta > 0 ? '+' : ''}{h.scoreDelta})</span></div>
              {h.fixed.length > 0 && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Fixed: {h.fixed.join(' · ')}</p>}
              {h.regressed.length > 0 && <p className="mt-1 text-xs text-red-500">Regressed: {h.regressed.join(' · ')}</p>}
              {h.fixed.length === 0 && h.regressed.length === 0 && <p className="muted mt-1 text-xs">No measurable checklist change — review the visual result yourself.</p>}
            </motion.div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {!terminal && <Button size="sm" variant="secondary" onClick={cancel}>Cancel</Button>}
        {terminal && onClose && <Button size="sm" variant="ghost" onClick={onClose}>Dismiss</Button>}
      </div>
    </Card>
  );
}
