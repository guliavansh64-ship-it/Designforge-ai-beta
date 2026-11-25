import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Smartphone, Tablet, Monitor, Globe, Wand2, Coins, Lock, Plus, X } from 'lucide-react';
import { CREDIT_COSTS, WEBSITE_CATEGORIES, TEMPLATE_CATEGORIES } from '@designforge/shared';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { Project } from '../lib/types';
import { Button, Card, ErrorBox, PageHeader, Tabs, cx } from '../components/ui';

type Mode = 'any' | 'ui' | 'website';
const UI_IDEAS = [
  'A fintech mobile app home screen with balance card, quick actions (send, request, pay bills) and recent transactions list',
  'A habit tracker onboarding flow screen: friendly illustration area, 3 benefit bullets, primary "Get started" button',
  'A SaaS analytics dashboard with sidebar navigation, KPI cards, revenue line chart and a recent orders table',
  'A food delivery restaurant detail screen with hero photo, rating, menu categories tabs and add-to-cart buttons',
];
const SITE_IDEAS = [
  'A modern website for an Ayurvedic wellness clinic in Jaipur: calm earthy palette, services, doctor profiles, testimonials, booking CTA',
  'A landing website for a B2B invoicing SaaS: bold hero, logo cloud, feature grid, pricing table, FAQ, final CTA',
  'A portfolio website for a product designer: case study grid, about section with photo, process, contact form',
];
const STYLES = ['Clean & minimal', 'Bold & vibrant', 'Dark & premium', 'Playful & rounded', 'Corporate & trustworthy', 'Editorial & elegant', 'Glassmorphism', 'Neo-brutalist'];

export default function StudioHome({ mode }: { mode: Mode }) {
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState<'ui' | 'website'>(mode === 'website' ? 'website' : 'ui');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>(mode === 'website' ? 'DESKTOP' : (me?.preferences.defaultDevice as any) ?? 'MOBILE');
  const [model, setModel] = useState<'GEMINI_3_FLASH' | 'GEMINI_3_1_PRO'>('GEMINI_3_FLASH');
  const [category, setCategory] = useState<string>('');
  const [style, setStyle] = useState('');
  const [pages, setPages] = useState<string[]>(['Home', 'About', 'Services', 'Contact']);
  const [newPage, setNewPage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const isSite = kind === 'website';
  const hasPro = me?.plan.features.includes('pro_model');
  const siteAllowed = me?.plan.features.includes('website_studio');
  const cost = model === 'GEMINI_3_1_PRO' ? CREDIT_COSTS.generate_pro : CREDIT_COSTS.generate_flash;

  const enhance = () => {
    // Deterministic, local prompt structuring (no AI call, no credits).
    const lines = [prompt.trim()];
    if (!/audience|for (users|people|customers)/i.test(prompt)) lines.push('Target audience: describe who uses this and their main goal.');
    if (isSite) lines.push(`Sections: sticky header with navigation, hero with primary CTA, ${category ? category.toLowerCase() + '-specific ' : ''}content sections, social proof, footer with contact.`);
    else lines.push('Include: clear primary action, logical visual hierarchy, realistic content (no lorem ipsum).');
    if (style) lines.push(`Visual style: ${style}.`);
    setPrompt(lines.join('\n'));
  };

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const { project } = await api.post<{ project: Project }>('/projects', { name: name.trim() || (prompt.trim().split(/[.,\n]/)[0].slice(0, 60) || 'Untitled design'), kind, deviceType: device });
      const firstPage = project.pages[0];
      if (isSite && pages[0] && pages[0] !== firstPage.name) await api.patch(`/projects/${project.id}/pages/${firstPage.id}`, { name: pages[0] });
      const { job } = await api.post<{ job: { id: string } }>(`/projects/${project.id}/generate`, {
        prompt, deviceType: device, model, pageId: firstPage.id, category: category || undefined, style: style || undefined, idempotencyKey: newKey(),
      });
      if (isSite && pages.length > 1) sessionStorage.setItem(`df_pending_pages_${project.id}`, JSON.stringify(pages.slice(1)));
      nav(`/studio/${project.id}?job=${job.id}`);
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).code === 'UI_PREVIEW') toast('info', (e as ApiError).message);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Powered by your Google Stitch account" title={mode === 'website' ? 'Website Designer' : mode === 'ui' ? 'UI/UX Designer' : 'AI Design Studio'}
        subtitle={isSite ? 'Describe your business and the pages you need. DesignForge structures the brief, Stitch generates the design, and you refine it in the editor.' : 'Describe the screen you want. Pick a device, a style and generate — then edit, iterate and export.'} />
      {mode === 'any' && <Tabs className="mb-6" value={kind} onChange={(k) => { setKind(k); setDevice(k === 'website' ? 'DESKTOP' : 'MOBILE'); }} items={[{ id: 'ui', label: 'App UI', icon: <Smartphone className="h-3.5 w-3.5" /> }, { id: 'website', label: 'Website', icon: <Globe className="h-3.5 w-3.5" /> }]} />}

      {isSite && !siteAllowed && <ErrorBox className="mb-6" error={Object.assign(new Error('Website Studio is available on Pro, Premium and Lifetime plans.'), { action: 'upgrade_plan' }) as any} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="p-5 sm:p-6">
          <label className="label" htmlFor="pname">Project name</label>
          <input id="pname" className="field" placeholder={isSite ? 'e.g. Ember & Oak Café' : 'e.g. Pulse fintech app'} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

          <div className="mt-5 flex items-center justify-between">
            <label className="label !mb-0" htmlFor="prompt">{isSite ? 'Business brief' : 'Describe the screen'}</label>
            <button onClick={enhance} disabled={prompt.trim().length < 5} className="inline-flex items-center gap-1 text-xs font-medium text-forge-500 hover:underline disabled:opacity-40"><Wand2 className="h-3.5 w-3.5" />Structure my prompt</button>
          </div>
          <textarea id="prompt" className="field mt-1.5 min-h-[160px] resize-y leading-relaxed" maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder={isSite ? 'What does the business do, who are the customers, what should visitors do?' : 'What is the screen for, what content does it show, what is the main action?'} />
          <div className="mt-1 flex justify-between text-[11px] muted"><span>Be specific about content, audience and primary action.</span><span>{prompt.length}/4000</span></div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(isSite ? SITE_IDEAS : UI_IDEAS).map((i) => (
              <button key={i} onClick={() => setPrompt(i)} className="surface-2 max-w-full truncate rounded-full px-3 py-1 text-xs muted hover:text-ink-900 dark:hover:text-white" title={i}>{i.slice(0, 48)}…</button>
            ))}
          </div>

          {isSite && (
            <div className="mt-6">
              <span className="label">Pages</span>
              <div className="flex flex-wrap gap-2">
                {pages.map((p, i) => (
                  <span key={p + i} className="inline-flex items-center gap-1 rounded-full bg-forge-500/10 px-3 py-1 text-xs font-medium text-forge-600 dark:text-forge-300">
                    {i === 0 && <span className="text-[10px] uppercase opacity-70">first ·</span>}{p}
                    {pages.length > 1 && <button aria-label={`Remove ${p}`} onClick={() => setPages(pages.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>}
                  </span>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); if (newPage.trim() && pages.length < 12) { setPages([...pages, newPage.trim().slice(0, 40)]); setNewPage(''); } }} className="inline-flex">
                  <input className="field !h-7 !w-32 !rounded-full !py-0 !text-xs" placeholder="Add page" value={newPage} onChange={(e) => setNewPage(e.target.value)} />
                  <button className="ml-1 rounded-full p-1 text-forge-500" aria-label="Add page"><Plus className="h-4 w-4" /></button>
                </form>
              </div>
              <p className="muted mt-2 text-[11px]">The first page is generated now. The others appear in the editor as one-click "generate in the same style" steps (each uses its own credits and Stitch quota).</p>
            </div>
          )}

          <ErrorBox error={error} className="mt-5" />

          <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs muted"><Coins className="h-3.5 w-3.5 text-amber-500" />{cost} credits · refunded automatically if generation fails</p>
            <Button size="lg" variant="ember" loading={busy} disabled={prompt.trim().length < 5 || (isSite && !siteAllowed)} onClick={start} icon={<Sparkles className="h-4 w-4" />}>Generate design</Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <span className="label">Device</span>
            <div className="grid grid-cols-3 gap-2">
              {([['MOBILE', Smartphone, 'Mobile'], ['TABLET', Tablet, 'Tablet'], ['DESKTOP', Monitor, 'Desktop']] as const).map(([d, I, l]) => (
                <button key={d} onClick={() => setDevice(d)} className={cx('focus-ring flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition', device === d ? 'border-forge-500 bg-forge-500/10 text-forge-600 dark:text-forge-300' : 'border-ink-200 muted hover:border-ink-300 dark:border-ink-700')}>
                  <I className="h-5 w-5" />{l}
                </button>
              ))}
            </div>
            <span className="label mt-5">Model</span>
            <div className="space-y-2">
              {([['GEMINI_3_FLASH', 'Gemini 3 Flash', 'Fast · 2 credits', false], ['GEMINI_3_1_PRO', 'Gemini 3.1 Pro', 'Higher fidelity · 5 credits', !hasPro]] as const).map(([id, l, d, locked]) => (
                <button key={id} disabled={locked} onClick={() => setModel(id)} className={cx('focus-ring flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:opacity-50', model === id ? 'border-forge-500 bg-forge-500/10' : 'border-ink-200 dark:border-ink-700')}>
                  <span><span className="font-medium">{l}</span><span className="muted block text-xs">{d}</span></span>{locked && <Lock className="h-4 w-4 muted" />}
                </button>
              ))}
            </div>
            <p className="muted mt-2 text-[11px]">Models run in your Stitch account; Google's limits for your account apply.</p>
          </Card>
          <Card className="p-5">
            <label className="label" htmlFor="cat">{isSite ? 'Business category' : 'App category'}</label>
            <select id="cat" className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose (optional)</option>
              {(isSite ? WEBSITE_CATEGORIES : TEMPLATE_CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="label mt-5">Style</span>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => (
                <motion.button whileTap={{ scale: 0.96 }} key={s} onClick={() => setStyle(style === s ? '' : s)} className={cx('rounded-full border px-2.5 py-1 text-xs transition', style === s ? 'border-forge-500 bg-forge-500/15 text-forge-600 dark:text-forge-200' : 'border-ink-200 muted dark:border-ink-700')}>{s}</motion.button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
