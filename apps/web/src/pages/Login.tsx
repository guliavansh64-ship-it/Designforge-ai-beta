import { motion } from 'framer-motion';
import { Sparkles, ShieldCheck, Wand2, Download, KeyRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { firebaseConfigured } from '../lib/firebase';
import { Button, Logo } from '../components/ui';

const G = () => (<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>);

export function Login() {
  const { signIn, error } = useAuth();
  const features = [
    { icon: Sparkles, t: 'Generate UI & websites', d: 'Powered by Google Stitch — through your own account.' },
    { icon: Wand2, t: 'Improve existing designs', d: 'A 9-stage audit → fix → compare loop with a transparent checklist.' },
    { icon: Download, t: 'Export real code', d: 'HTML or React + TypeScript projects that are build-checked.' },
    { icon: KeyRound, t: 'Your keys stay yours', d: 'Encrypted server-side. Never shared, never in the app bundle.' },
  ];
  return (
    <div className="relative grid min-h-full overflow-hidden bg-ink-950 text-ink-100 lg:grid-cols-[1.1fr_1fr]">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-forge-600/30 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[420px] w-[420px] rounded-full bg-ember-500/20 blur-[120px]" />
      <section className="relative hidden flex-col justify-between border-r border-ink-850 bg-grid-faint [background-size:32px_32px] p-12 lg:flex">
        <Logo />
        <div>
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">
            Design, refine and ship<br /><span className="gradient-text">with your own AI.</span>
          </motion.h1>
          <div className="mt-10 grid max-w-xl grid-cols-2 gap-4">
            {features.map((f, i) => (
              <motion.div key={f.t} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="rounded-2xl border border-ink-800 bg-ink-900/60 p-4 backdrop-blur">
                <f.icon className="h-5 w-5 text-forge-300" />
                <p className="mt-3 text-sm font-semibold">{f.t}</p>
                <p className="mt-1 text-xs text-ink-400">{f.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-500">Google Stitch is a Google product. DesignForge AI is an independent tool that connects to it with your authorization.</p>
      </section>
      <section className="relative flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">Welcome</h2>
          <p className="mt-2 text-sm text-ink-400">Sign in to DesignForge AI. Connecting Google Stitch is a separate, optional step you control in Integrations.</p>
          <Button size="lg" variant="secondary" className="mt-8 w-full !bg-white !text-ink-900 hover:!bg-ink-100" onClick={signIn} disabled={!firebaseConfigured} icon={<G />}>Continue with Google</Button>
          {!firebaseConfigured && <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">Firebase isn't configured for this build. Set the <code>VITE_FIREBASE_*</code> variables (see docs/03-ENVIRONMENT.md).</p>}
          {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300" role="alert">{error}</p>}
          <div className="mt-8 flex items-start gap-2 text-xs text-ink-500"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" /> We only request your basic Google profile (name, email, photo). We never see your Google password.</div>
        </motion.div>
      </section>
    </div>
  );
}
