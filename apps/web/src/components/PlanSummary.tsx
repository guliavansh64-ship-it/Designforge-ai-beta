import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Circle, Loader2, Sparkles, XCircle } from 'lucide-react';
import type { DesignPlanSummary } from '@designforge/shared';
import { cx } from './ui';

/** What the prompt enhancer produced: app name, shared theme and screens (+ per-screen progress in a job). */
export function PlanSummary({ plan, done, active, failed, defaultOpen = true }: { plan: DesignPlanSummary; done?: number; active?: boolean; failed?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const t = plan.theme;
  return (
    <div className="surface-2 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-forge-500" />
        <p className="min-w-0 flex-1 truncate font-semibold">{plan.appName}</p>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', plan.enhancer === 'gemini' ? 'bg-forge-500/15 text-forge-600 dark:text-forge-300' : 'bg-ink-200 text-ink-700 dark:bg-ink-800 dark:text-ink-300')}>
          {plan.enhancer === 'gemini' ? 'Enhanced by Gemini' : 'Enhanced (built-in)'}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {[t.primary, t.accent, t.background].map((c, i) => <span key={i} title={c} className="h-5 w-5 rounded-md ring-1 ring-black/10" style={{ background: c }} />)}
        <span className="muted min-w-0 flex-1 truncate text-xs">{t.dark ? 'Dark' : 'Light'} · {t.headingFont} / {t.bodyFont} · {t.mood}</span>
      </div>
      <button onClick={() => setOpen((o) => !o)} className="mt-3 flex w-full items-center justify-between text-left text-sm font-medium">
        {plan.screens.length > 1 ? `${plan.screens.length} screens · one shared theme` : '1 screen'}
        <ChevronDown className={cx('h-4 w-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5">
          {plan.screens.map((s, i) => {
            const state = done === undefined ? 'plan' : i < done ? 'done' : i === done && active ? 'active' : i === done && failed ? 'failed' : 'todo';
            return (
              <motion.li key={s.name + i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="flex gap-2 text-sm">
                <span className="mt-0.5">{state === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : state === 'active' ? <Loader2 className="h-4 w-4 animate-spin text-forge-400" /> : state === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> : <Circle className="h-4 w-4 muted" />}</span>
                <span className="min-w-0"><span className="font-medium">{i + 1}. {s.name}</span>{done === undefined && <span className="muted line-clamp-2 block text-xs">{s.prompt}</span>}</span>
              </motion.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
