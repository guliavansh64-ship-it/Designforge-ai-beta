import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PenTool, Sparkles, Download, Copy, Plug, Coins, Info, Lock } from 'lucide-react';
import { LOGO_STYLES, CREDIT_COSTS } from '@designforge/shared';
import { api, assetUrl, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useJob } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Project, VersionListItem } from '../lib/types';
import { JobProgress } from '../components/JobProgress';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, cx } from '../components/ui';

interface LogoMeta { style: string; palette: string[]; typography: { heading: string; body: string; why: string }; assets: Record<string, string | null> }
type LogoVersion = VersionListItem & { logo?: LogoMeta };

function AssetImg({ url, alt, className }: { url?: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => { assetUrl(url).then(setSrc); }, [url]);
  return src ? <img src={src} alt={alt} className={className} loading="lazy" /> : <div className={cx('skeleton', className)} />;
}

export default function LogoStudio() {
  const { projectId } = useParams();
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const gemini = me?.connections.find((c) => c.provider === 'gemini');
  const allowed = me?.plan.features.includes('logo_studio');
  const list = useApi<{ projects: Project[] }>(projectId ? null : '/projects?kind=logo&limit=30');

  const [brandName, setBrandName] = useState('');
  const [industry, setIndustry] = useState('');
  const [tagline, setTagline] = useState('');
  const [colorHints, setColorHints] = useState('');
  const [styles, setStyles] = useState<string[]>(['Minimalist', 'Icon']);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [concepts, setConcepts] = useState<LogoVersion[]>([]);
  const [active, setActive] = useState<LogoVersion | null>(null);
  const [bg, setBg] = useState<'light' | 'dark' | 'transparent' | 'monoWhite'>('light');

  const loadConcepts = async (pid: string) => {
    const [{ project: p }, { versions }] = await Promise.all([api.get<{ project: Project }>(`/projects/${pid}`), api.get<{ versions: LogoVersion[] }>(`/projects/${pid}/versions?limit=50`)]);
    setProject(p);
    const heads = new Set(p.pages.map((x) => x.currentVersionId));
    const c = versions.filter((v) => v.source === 'logo' && heads.has(v.id));
    setConcepts(c); setActive((a) => a ?? c[0] ?? null);
    if (!brandName && p.name) setBrandName(p.name.replace(/ brand$/i, ''));
  };
  useEffect(() => { if (projectId) loadConcepts(projectId).catch((e) => setErr(e)); /* eslint-disable-next-line */ }, [projectId]);

  const job = useJob(jobId, async (j) => {
    refresh();
    if (j.status === 'succeeded' && projectId) { await loadConcepts(projectId); toast('success', 'Logo concepts ready.'); }
    else if (j.status === 'failed') toast('error', j.error?.message ?? 'Logo generation failed — credits refunded.');
  });
  const running = job && !['succeeded', 'failed', 'cancelled'].includes(job.status);

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      let pid = projectId;
      if (!pid) {
        const { project: p } = await api.post<{ project: Project }>('/projects', { name: `${brandName} brand`, kind: 'logo', deviceType: 'AGNOSTIC' });
        pid = p.id;
      }
      const { job: j } = await api.post<{ job: { id: string } }>(`/projects/${pid}/logos`, { brandName, industry, styles, colorHints: colorHints || undefined, tagline: tagline || undefined, count, idempotencyKey: newKey() });
      setJobId(j.id);
      if (!projectId) nav(`/logo-studio/${pid}`, { replace: true });
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  const downloadKit = async (v: LogoVersion) => {
    try { await api.download('GET', `/versions/${v.id}/brand-kit`, undefined, 'brand-kit.zip'); toast('success', 'Brand kit downloaded.'); } catch (e) { toast('error', (e as Error).message); }
  };

  const cost = CREDIT_COSTS.logo_batch * Math.ceil(count / 2);

  return (
    <div>
      <PageHeader eyebrow="Images by your Gemini account" title="Logo & Brand Studio" subtitle="Generate logo concepts, get transparent and dark-background variants, a colour palette and typography pairing — then download a brand kit." />

      <Card className="mb-6 flex items-start gap-3 border-sky-500/20 bg-sky-500/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
        <p>Google Stitch generates <b>UI screens</b>, not standalone logo artwork. Logo Studio therefore uses a <b>separate image model</b> (Gemini image generation) through <b>your own Gemini API key</b>. AI logos are raster images; only Wordmark concepts also get a true vector SVG. Always check trademarks before using a logo commercially.</p>
      </Card>

      {!allowed && <ErrorBox className="mb-6" error={Object.assign(new Error('Logo Studio is available on Pro, Premium and Lifetime plans.'), { action: 'upgrade_plan' }) as any} />}
      {allowed && gemini && !gemini.connected && (
        <Card className="mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <Plug className="h-5 w-5 text-ember-500" /><p className="flex-1 text-sm">Connect your Gemini API key (free tier available in Google AI Studio) to generate logos.</p>
          <Button onClick={() => nav('/integrations')}>Connect Gemini</Button>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit p-5">
          <fieldset disabled={!allowed || !gemini?.connected || !!running} className="space-y-4 disabled:opacity-60">
            <div><label className="label" htmlFor="bn">Brand name</label><input id="bn" className="field" maxLength={40} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. Kora" /></div>
            <div><label className="label" htmlFor="ind">Industry / what you do</label><input id="ind" className="field" maxLength={60} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Organic skincare" /></div>
            <div><label className="label" htmlFor="tg">Tagline (optional)</label><input id="tg" className="field" maxLength={140} value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
            <div><label className="label" htmlFor="ch">Colour preferences (optional)</label><input id="ch" className="field" maxLength={120} value={colorHints} onChange={(e) => setColorHints(e.target.value)} placeholder="e.g. sage green and cream" /></div>
            <div>
              <span className="label">Styles</span>
              <div className="flex flex-wrap gap-1.5">{LOGO_STYLES.map((s) => (
                <button key={s} type="button" onClick={() => setStyles((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])} className={cx('rounded-full border px-3 py-1 text-xs', styles.includes(s) ? 'border-forge-500 bg-forge-500/15 text-forge-600 dark:text-forge-200' : 'border-ink-200 muted dark:border-ink-700')}>{s}</button>
              ))}</div>
            </div>
            <div><span className="label">Concepts</span>
              <div className="grid grid-cols-4 gap-1.5">{[1, 2, 3, 4].map((n) => <button key={n} type="button" onClick={() => setCount(n)} className={cx('rounded-lg border py-1.5 text-sm', count === n ? 'border-forge-500 bg-forge-500/10' : 'border-ink-200 dark:border-ink-700')}>{n}</button>)}</div></div>
            <ErrorBox error={err} className="!p-3 !text-xs" />
            <Button className="w-full" variant="ember" loading={busy} disabled={!brandName.trim() || industry.trim().length < 2 || !styles.length} onClick={generate} icon={<Sparkles className="h-4 w-4" />}>Generate concepts</Button>
            <p className="flex items-center gap-1 text-[11px] muted"><Coins className="h-3 w-3 text-amber-500" />{cost} credits · plus your Gemini image quota</p>
          </fieldset>
        </Card>

        <div className="space-y-6">
          {job && (running || job.status === 'failed') && <JobProgress job={job} onClose={() => setJobId(null)} />}
          {!projectId ? (
            list.loading ? <Spinner /> : list.data?.projects.length ? (
              <Card className="p-5"><h2 className="mb-3 font-display font-semibold">Your brand projects</h2>
                <div className="grid gap-2 sm:grid-cols-2">{list.data.projects.map((p) => <button key={p.id} onClick={() => nav(`/logo-studio/${p.id}`)} className="surface-2 flex items-center gap-3 rounded-xl p-3 text-left hover:ring-1 hover:ring-forge-500/40"><PenTool className="h-5 w-5 text-forge-500" /><span className="flex-1 truncate text-sm font-medium">{p.name}</span><Badge>{p.pages.length} concepts</Badge></button>)}</div>
              </Card>
            ) : <Empty icon={<PenTool className="h-6 w-6" />} title="No brands yet" body="Fill in the brief and generate your first logo concepts." />
          ) : !concepts.length && !running ? <Empty icon={<PenTool className="h-6 w-6" />} title={project ? `${project.name}` : 'Loading…'} body="No concepts yet — generate some from the brief." /> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {concepts.map((c) => (
                  <motion.button key={c.id} whileHover={{ y: -2 }} onClick={() => setActive(c)} className={cx('surface overflow-hidden rounded-2xl text-left', active?.id === c.id && 'ring-2 ring-forge-500')}>
                    <AssetImg url={c.imageUrl} alt={`${c.logo?.style} logo concept`} className="aspect-square w-full bg-white object-contain p-3" />
                    <div className="flex items-center justify-between px-3 py-2 text-xs"><span className="font-medium">{c.logo?.style}</span><div className="flex -space-x-1">{c.logo?.palette.slice(0, 4).map((col) => <span key={col} className="h-3.5 w-3.5 rounded-full ring-2 ring-white dark:ring-ink-900" style={{ background: col }} />)}</div></div>
                  </motion.button>
                ))}
              </div>
              {active?.logo && (
                <Card className="p-5">
                  <div className="flex flex-col gap-6 lg:flex-row">
                    <div className="lg:w-1/2">
                      <div className="mb-2 flex gap-1">{(['light', 'dark', 'transparent', 'monoWhite'] as const).filter((k) => active.logo!.assets[k]).map((k) => <button key={k} onClick={() => setBg(k)} className={cx('rounded-lg px-2.5 py-1 text-xs', bg === k ? 'bg-forge-500 text-white' : 'surface-2')}>{k === 'monoWhite' ? 'Mono white' : k[0].toUpperCase() + k.slice(1)}</button>)}</div>
                      <div className={cx('grid aspect-square place-items-center rounded-2xl p-6', bg === 'light' ? 'bg-white' : bg === 'transparent' ? 'bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] [background-size:20px_20px]' : 'bg-ink-950')}>
                        <AssetImg url={active.logo.assets[bg] ? `/api/assets/${active.logo.assets[bg]}` : active.imageUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                      </div>
                      {bg === 'transparent' && <p className="muted mt-2 text-[11px]">Background removal works best on flat logos with a plain background; check edges before printing.</p>}
                    </div>
                    <div className="flex-1 space-y-5">
                      <div><span className="label">Palette</span><div className="flex flex-wrap gap-2">{active.logo.palette.map((c) => (
                        <button key={c} onClick={() => { navigator.clipboard.writeText(c); toast('success', `Copied ${c}`); }} className="group text-center"><span className="block h-12 w-12 rounded-xl ring-1 ring-black/10" style={{ background: c }} /><span className="mt-1 flex items-center gap-0.5 font-mono text-[10px] muted">{c}<Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" /></span></button>
                      ))}</div></div>
                      <div><span className="label">Typography pairing</span><p className="text-sm"><b>{active.logo.typography.heading}</b> for headings · <b>{active.logo.typography.body}</b> for body</p><p className="muted mt-1 text-xs">{active.logo.typography.why}</p></div>
                      <div><span className="label">Files in brand kit</span><ul className="muted space-y-0.5 text-xs"><li>• PNG on white, on dark, transparent, mono white</li><li>• {active.logo.assets.svg ? 'True vector SVG (wordmark)' : <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />SVG not available for raster AI logos</span>}</li><li>• palette.json, colors.css, typography.md, brand-guide.html</li></ul></div>
                      <Button icon={<Download className="h-4 w-4" />} onClick={() => downloadKit(active)}>Download brand kit (.zip)</Button>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
