import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, KeyRound, ExternalLink, RefreshCw, Unplug, ShieldCheck, Eye, EyeOff, Sparkles, Image as ImageIcon, Figma, Github } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { ConnectionStatus } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader } from '../components/ui';

const PROVIDERS = {
  stitch: {
    name: 'Google Stitch', icon: Sparkles, role: 'Generates UI screens and websites in your own Stitch account.',
    keyUrl: 'https://stitch.withgoogle.com/settings', keyLabel: 'Stitch API key',
    steps: ['Open stitch.withgoogle.com and sign in with your Google account', 'Open Settings (profile menu) → API keys', 'Create a key and copy it', 'Paste it below — we verify it with a read-only call'],
    note: 'Generations count against your own Stitch quota (Google currently offers a free monthly allowance; limits are set by Google and may change).',
  },
  gemini: {
    name: 'Gemini (image generation)', icon: ImageIcon, role: 'Used only by Logo Studio to create logo images. Stitch does not generate standalone images.',
    keyUrl: 'https://aistudio.google.com/app/apikey', keyLabel: 'Gemini API key',
    steps: ['Open Google AI Studio and sign in', 'Click "Create API key" (choose or create a Google Cloud project)', 'Copy the key', 'Paste it below — we verify it with a read-only call'],
    note: 'Usage is billed/limited by Google on your own account. Image models may require billing to be enabled on your Google Cloud project.',
  },
} as const;
type P = keyof typeof PROVIDERS;

const STATUS: Record<ConnectionStatus['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  active: { label: 'Connected', tone: 'green' }, invalid: { label: 'Key invalid', tone: 'red' }, revoked: { label: 'Revoked', tone: 'red' },
  not_connected: { label: 'Not connected', tone: 'neutral' }, no_access: { label: 'No Stitch access', tone: 'amber' }, quota_exceeded: { label: 'Quota reached', tone: 'amber' },
};

export default function Integrations() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<P | null>(null);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [revoke, setRevoke] = useState<{ provider: P; url: string } | null>(null);

  const connect = async () => {
    if (!open) return;
    setBusy('connect'); setErr(null);
    try { await api.post(`/connections/${open}`, { apiKey: key.trim() }); setKey(''); setOpen(null); setConsent(false); toast('success', `${PROVIDERS[open].name} connected and verified.`); refresh(); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const verify = async (p: P) => {
    setBusy('verify' + p);
    try { const r = await api.post<{ ok: boolean }>(`/connections/${p}/verify`); toast(r.ok ? 'success' : 'error', r.ok ? 'Connection verified.' : 'Verification failed — see the status for details.'); refresh(); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const disconnect = async (p: P) => {
    if (!window.confirm(`Disconnect ${PROVIDERS[p].name}? The encrypted key is deleted from Designo immediately.`)) return;
    setBusy('dis' + p);
    try { const r = await api.del<{ revokeUrl: string }>(`/connections/${p}`); refresh(); setRevoke({ provider: p, url: r.revokeUrl }); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect your own AI accounts. Signing in to Designo with Google does NOT give us access to Stitch — that's this separate, explicit step." />

      <Card className="mb-6 flex gap-3 border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        <div><p className="font-medium">How your keys are protected</p>
          <p className="muted mt-1 text-xs leading-relaxed">Keys are sent over HTTPS, verified, then encrypted with AES-256-GCM on our server (bound to your account) and never returned to any browser or app — we only show the last 4 characters. They are used only for your own requests, never for other users, and there is no shared or admin key fallback. We never ask for your Google password.</p></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {(Object.keys(PROVIDERS) as P[]).map((p, i) => {
          const def = PROVIDERS[p]; const c = me?.connections.find((x) => x.provider === p);
          const st = STATUS[c?.status ?? 'not_connected'];
          return (
            <motion.div key={p} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="h-full p-6">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-forge-500/10 p-3 text-forge-500"><def.icon className="h-6 w-6" /></div>
                  <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-display font-semibold">{def.name}</p><Badge tone={st.tone}>{c?.connected ? <CheckCircle2 className="h-3 w-3" /> : c?.status !== 'not_connected' ? <AlertTriangle className="h-3 w-3" /> : null}{st.label}</Badge></div><p className="muted mt-1 text-sm">{def.role}</p></div>
                </div>
                {c?.connected || (c && c.status !== 'not_connected') ? (
                  <div className="mt-5 space-y-3">
                    <div className="surface-2 grid grid-cols-2 gap-3 rounded-xl p-3 text-xs"><div><p className="muted">Key</p><p className="font-mono">••••{c.keyHint?.replace('…', '')}</p></div><div><p className="muted">Last verified</p><p>{c.lastVerifiedAt ? timeAgo(c.lastVerifiedAt) : '—'}</p></div></div>
                    {c.lastError && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{c.lastError}</p>}
                    {c.status === 'no_access' && <p className="text-xs muted">Your Google account doesn't appear to have Stitch access yet. Open stitch.withgoogle.com once to accept the terms, then re-verify.</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" loading={busy === 'verify' + p} onClick={() => verify(p)} icon={<RefreshCw className="h-3.5 w-3.5" />}>Re-verify</Button>
                      <Button size="sm" variant="secondary" onClick={() => { setOpen(p); setErr(null); }} icon={<KeyRound className="h-3.5 w-3.5" />}>Replace key</Button>
                      <Button size="sm" variant="ghost" className="!text-red-600" loading={busy === 'dis' + p} onClick={() => disconnect(p)} icon={<Unplug className="h-3.5 w-3.5" />}>Disconnect</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5"><ol className="muted mb-4 list-inside list-decimal space-y-1 text-xs">{def.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <div className="flex flex-wrap gap-2"><Button onClick={() => { setOpen(p); setErr(null); }} icon={<KeyRound className="h-4 w-4" />}>Connect</Button><a href={def.keyUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 px-3 text-sm text-forge-500 hover:underline">Get a key <ExternalLink className="h-3.5 w-3.5" /></a></div></div>
                )}
                <p className="muted mt-4 text-[11px]">{def.note}</p>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">Not available (and why)</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex gap-3 p-5 text-sm"><Figma className="h-5 w-5 shrink-0 muted" /><div><p className="font-medium">Figma</p><p className="muted mt-1 text-xs">Not offered: there's no supported public API path to create editable Figma designs from Stitch output. We won't ship a fake button.</p></div></Card>
        <Card className="flex gap-3 p-5 text-sm"><Github className="h-5 w-5 shrink-0 muted" /><div><p className="font-medium">GitHub push</p><p className="muted mt-1 text-xs">Planned. For now, download the React/HTML ZIP from the Export Center and push it yourself.</p></div></Card>
      </div>

      <Modal open={!!open} onClose={() => { setOpen(null); setKey(''); setConsent(false); }} title={open ? `Connect ${PROVIDERS[open].name}` : ''}>
        {open && (<form onSubmit={(e) => { e.preventDefault(); connect(); }}>
          <ol className="muted mb-4 list-inside list-decimal space-y-1 text-xs">{PROVIDERS[open].steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <a href={PROVIDERS[open].keyUrl} target="_blank" rel="noreferrer noopener" className="mb-4 inline-flex items-center gap-1 text-sm text-forge-500 hover:underline">Open {open === 'stitch' ? 'Stitch settings' : 'Google AI Studio'} <ExternalLink className="h-3.5 w-3.5" /></a>
          <label className="label" htmlFor="apikey">{PROVIDERS[open].keyLabel}</label>
          <div className="relative"><input id="apikey" autoComplete="off" spellCheck={false} type={show ? 'text' : 'password'} className="field pr-10 font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 muted" aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
          <label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-forge-500" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I authorize Designo to store this key encrypted and use it <b>only for requests I make</b> (generating, editing and reading designs in my account). I can disconnect at any time.</span></label>
          <ErrorBox error={err} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button><Button loading={busy === 'connect'} disabled={key.trim().length < 20 || !consent}>Verify & connect</Button></div>
        </form>)}
      </Modal>
      <Modal open={!!revoke} onClose={() => setRevoke(null)} title="Disconnected">
        <p className="text-sm">The encrypted key was deleted from Designo. For complete safety, also revoke/delete the key at the source so it can't be used anywhere.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setRevoke(null)}>Done</Button><a href={revoke?.url} target="_blank" rel="noreferrer noopener"><Button icon={<ExternalLink className="h-4 w-4" />}>Revoke at source</Button></a></div>
      </Modal>
    </div>
  );
}
