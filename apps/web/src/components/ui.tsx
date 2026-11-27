import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X, AlertTriangle, Plug, CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ember';
const variants: Record<Variant, string> = {
  primary: 'bg-forge-500 text-white hover:bg-forge-600 shadow-[0_8px_24px_-10px_rgba(124,92,255,.8)]',
  ember: 'bg-forge-gradient text-white hover:brightness-110 shadow-[0_8px_24px_-10px_rgba(255,122,69,.6)]',
  secondary: 'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50 dark:bg-ink-850 dark:text-ink-100 dark:border-ink-700 dark:hover:bg-ink-800',
  ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button ref={ref} disabled={disabled || loading}
      className={cx('focus-ring inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm', variants[variant], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ));

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('surface rounded-2xl', className)} {...rest}>{children}</div>;
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'forge' | 'green' | 'amber' | 'red'; className?: string }) {
  const t = {
    neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
    forge: 'bg-forge-500/15 text-forge-600 dark:text-forge-300',
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', t, className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cx('h-5 w-5 animate-spin text-forge-400', className)} aria-label="Loading" />; }

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            className={cx('surface max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="focus-ring rounded-lg p-1 muted hover:text-ink-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 px-6 py-14 text-center dark:border-ink-700">
      <div className="mb-3 rounded-2xl bg-forge-500/10 p-3 text-forge-500">{icon}</div>
      <h3 className="font-display font-semibold">{title}</h3>
      {body && <p className="muted mt-1 max-w-sm text-sm">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-forge-500">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="muted mt-1 max-w-2xl text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('focus-ring relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-forge-500' : 'bg-ink-300 dark:bg-ink-700')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full bg-forge-gradient" initial={{ width: 0 }} animate={{ width: `${Math.max(2, Math.min(100, value))}%` }} transition={{ ease: 'easeOut' }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('inline-flex rounded-xl bg-ink-100 p-1 dark:bg-ink-850', className)}>
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}
          className={cx('focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value === i.id ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white' : 'muted hover:text-ink-900 dark:hover:text-white')}>
          {i.icon}{i.label}
        </button>
      ))}
    </div>
  );
}

/** Maps API errors to actionable UI (connect Stitch, upgrade, buy credits). */
export function ErrorBox({ error, className }: { error: ApiError | Error | null | undefined; className?: string }) {
  const nav = useNavigate();
  if (!error) return null;
  const e = error as ApiError;
  const action = e.action === 'open_integrations' ? { label: 'Open Integrations', to: '/integrations', icon: <Plug className="h-4 w-4" /> }
    : e.action === 'upgrade_plan' ? { label: 'View plans', to: '/subscription', icon: <CreditCard className="h-4 w-4" /> }
    : e.action === 'open_billing' ? { label: 'Get credits', to: '/credits', icon: <CreditCard className="h-4 w-4" /> } : null;
  return (
    <div className={cx('flex flex-col gap-3 rounded-2xl border border-ember-500/30 bg-ember-500/10 p-4 text-sm sm:flex-row sm:items-center', className)} role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0 text-ember-500" />
      <p className="flex-1 whitespace-pre-line">{e.message}</p>
      {action && <Button size="sm" variant="secondary" icon={action.icon} onClick={() => nav(action.to)}>{action.label}</Button>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton', className)} />; }

export function Avatar({ src, name, size = 32 }: { src?: string | null; name?: string | null; size?: number }) {
  const initials = (name ?? '?').split(/\s|@/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  return src
    ? <img src={src} alt="" width={size} height={size} className="rounded-full object-cover ring-2 ring-white/10" referrerPolicy="no-referrer" />
    : <div style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-forge-gradient text-xs font-bold text-white">{initials}</div>;
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="dfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c5cff" /><stop offset=".55" stopColor="#b06cff" /><stop offset="1" stopColor="#ff7a45" /></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#dfg)" /><path d="M9 23V9h10l-2.2 4.2H13.6v2.2h4.4l-2.2 4.2h-2.2V23z" fill="#fff" /></svg>
      {!compact && <span className="font-display text-[15px] font-semibold tracking-tight">Designo<span className="gradient-text"> AI</span></span>}
    </div>
  );
}

/** Lightweight SVG bar chart (no chart library → smaller bundle). */
export function BarChart({ data, height = 140, format = (n: number) => String(n), color = 'url(#bcg)' }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Bar chart">
      <defs><linearGradient id="bcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9a7bff" /><stop offset="1" stopColor="#6a45f0" /></linearGradient></defs>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 8);
        return <rect key={i} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={0.8} fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></rect>;
      })}
    </svg>
  );
}

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r;
  const tone = score >= 85 ? '#22c55e' : score >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative" style={{ width: size, height: size }} title="DesignForge heuristic score — share of automated checks passed (not an industry standard)">
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-ink-200 dark:stroke-ink-800" /><circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" stroke={tone} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} /></svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold">{score}</span>
    </div>
  );
}
