import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutTemplate, Search, Star, Eye } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi, useDebounced } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { Badge, Button, Empty, ErrorBox, Modal, PageHeader, Skeleton, Spinner, cx } from '../components/ui';
import { Preview } from '../components/Preview';

interface Tpl { id: string; name: string; category: string; description: string; accent?: string; dark?: boolean; featured?: boolean; qualityScore?: number; uses?: number; kind?: string; deviceType?: string; tags?: string[] }

export default function Templates() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error } = useApi<{ templates: Tpl[] }>('/templates');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200).toLowerCase();
  const [open, setOpen] = useState<Tpl | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [favs, setFavs] = useState<string[]>(() => JSON.parse(localStorage.getItem('df_favs') ?? '[]'));

  const cats = ['All', 'Favourites', ...new Set((data?.templates ?? []).map((t) => t.category))];
  const list = (data?.templates ?? []).filter((t) => (cat === 'All' || t.category === cat || (cat === 'Favourites' && favs.includes(t.id))) && (!dq || `${t.name} ${t.description} ${(t.tags ?? []).join(' ')}`.toLowerCase().includes(dq)));

  const preview = async (t: Tpl) => { setOpen(t); setHtml(null); setErr(null); try { setHtml((await api.get<{ template: { html: string } }>(`/templates/${t.id}`)).template.html); } catch (e) { setErr(e as ApiError); } };
  const use = async (t: Tpl) => { setBusy(true); setErr(null); try { const r = await api.post<{ projectId: string }>(`/templates/${t.id}/use`, {}); nav(`/studio/${r.projectId}`); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); } };
  const fav = async (t: Tpl) => {
    const on = !favs.includes(t.id);
    const next = on ? [...favs, t.id] : favs.filter((x) => x !== t.id);
    setFavs(next); localStorage.setItem('df_favs', JSON.stringify(next));
    api.post(`/templates/${t.id}/favorite`, { favorite: on }).catch(() => toast('error', 'Could not sync favourite'));
  };

  return (
    <div>
      <PageHeader title="Templates" subtitle="Hand-built, responsive, accessible starting points. Using a template is free — customise it in the editor, then iterate with AI." />
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" /><input className="field !pl-9" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium', cat === c ? 'bg-forge-500 text-white' : 'surface muted')}>{c}</button>)}</div>
      </div>
      <ErrorBox error={error} />
      {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        : !list.length ? <Empty icon={<LayoutTemplate className="h-6 w-6" />} title="No templates found" body={data?.templates.length ? 'Try another category.' : 'Your admin hasn\'t published templates yet (run the seed script).'} />
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 9) * 0.03 }} className="surface group overflow-hidden rounded-2xl">
            <button onClick={() => preview(t)} className="relative block h-36 w-full overflow-hidden text-left" style={{ background: t.dark ? '#0b0b12' : '#f8fafc' }} aria-label={`Preview ${t.name}`}>
              <div className="absolute inset-x-6 top-6 h-3 w-1/3 rounded-full" style={{ background: t.accent ?? '#7c5cff' }} />
              <div className={cx('absolute inset-x-6 top-14 h-5 w-3/4 rounded', t.dark ? 'bg-white/80' : 'bg-ink-900/80')} />
              <div className={cx('absolute inset-x-6 top-[84px] h-2.5 w-2/3 rounded', t.dark ? 'bg-white/30' : 'bg-ink-900/25')} />
              <div className="absolute left-6 top-[104px] h-6 w-24 rounded-lg" style={{ background: t.accent ?? '#7c5cff' }} />
              <span className="absolute inset-0 grid place-items-center bg-ink-950/0 opacity-0 transition group-hover:bg-ink-950/40 group-hover:opacity-100"><span className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-900"><Eye className="h-3.5 w-3.5" />Preview</span></span>
            </button>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{t.name}</p><p className="muted text-xs">{t.description}</p></div>
                <button onClick={() => fav(t)} aria-label={favs.includes(t.id) ? 'Remove favourite' : 'Add favourite'}><Star className={cx('h-4 w-4', favs.includes(t.id) ? 'fill-amber-400 text-amber-400' : 'muted')} /></button></div>
              <div className="mt-3 flex items-center gap-2"><Badge>{t.category}</Badge>{t.featured && <Badge tone="forge">Featured</Badge>}{t.qualityScore && <span className="muted ml-auto text-[11px]">checks {t.qualityScore}/100</span>}</div>
            </div>
          </motion.div>
        ))}</div>}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} wide>
        <div className="h-[460px] overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">{html ? <Preview html={html} device="DESKTOP" zoom="fit" /> : <div className="grid h-full place-items-center"><Spinner /></div>}</div>
        <ErrorBox error={err} className="mt-3" />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(null)}>Close</Button><Button loading={busy} onClick={() => open && use(open)}>Use this template</Button></div>
      </Modal>
    </div>
  );
}
