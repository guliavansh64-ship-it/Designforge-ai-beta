import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string; action?: { label: string; onClick: () => void } }
const Ctx = createContext<(kind: Kind, text: string, action?: Toast['action']) => void>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => {
            const I = Icon[t.kind];
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
                className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-ink-200 bg-white/95 p-3.5 text-sm shadow-xl backdrop-blur dark:border-ink-700 dark:bg-ink-850/95">
                <I className={`mt-0.5 h-4 w-4 shrink-0 ${t.kind === 'success' ? 'text-emerald-500' : t.kind === 'error' ? 'text-ember-500' : 'text-forge-400'}`} />
                <div className="flex-1 whitespace-pre-line">{t.text}{t.action && <button onClick={t.action.onClick} className="ml-2 font-semibold text-forge-500 hover:underline">{t.action.label}</button>}</div>
                <button aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="muted hover:text-ink-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
