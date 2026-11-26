import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Code2, Download, FileArchive, FileCode2, Image as ImageIcon, Monitor, Pencil, Smartphone, Tablet, X } from 'lucide-react';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import type { ProjectVersion, ProjectWithAccess } from '../lib/types';
import { Preview, type Device } from '../components/Preview';
import { Button, ErrorBox, cx } from '../components/ui';

const DEVICES: { id: Device; label: string; Icon: typeof Smartphone; w: number; h: number }[] = [
  { id: 'MOBILE', label: 'Mobile', Icon: Smartphone, w: 390, h: 844 },
  { id: 'TABLET', label: 'Tablet', Icon: Tablet, w: 834, h: 1112 },
  { id: 'DESKTOP', label: 'Desktop', Icon: Monitor, w: 1280, h: 800 },
];

/**
 * Full-screen, distraction-free preview of a generated app/website: Mobile / Tablet / Desktop buttons
 * on top, every screen of the app as a tab (← → keys switch), and downloads.
 */
export default function FullPreview() {
  const { projectId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me, refresh } = useAuth();
  const [project, setProject] = useState<ProjectWithAccess | null>(null);
  const [pageId, setPageId] = useState<string | null>(sp.get('page'));
  const [device, setDevice] = useState<Device>('MOBILE');
  const [versions, setVersions] = useState<Record<string, ProjectVersion>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ project: ProjectWithAccess }>(`/projects/${projectId}`).then(({ project: p }) => {
      setProject(p);
      setPageId((cur) => (cur && p.pages.some((x) => x.id === cur && x.currentVersionId) ? cur : p.pages.find((x) => x.currentVersionId)?.id ?? null));
      if (p.deviceType === 'DESKTOP' || p.deviceType === 'TABLET' || p.deviceType === 'MOBILE') setDevice(p.deviceType);
    }).catch((e) => setError(e));
  }, [projectId]);

  const pages = useMemo(() => (project?.pages ?? []).filter((p) => p.currentVersionId), [project]);
  const idx = pages.findIndex((p) => p.id === pageId);
  const page = pages[idx];
  const version = page?.currentVersionId ? versions[page.currentVersionId] : undefined;

  useEffect(() => {
    [idx, idx + 1, idx - 1].map((i) => pages[i]?.currentVersionId).filter((v): v is string => !!v && !versions[v])
      .forEach((vid) => api.get<{ version: ProjectVersion }>(`/versions/${vid}`).then((r) => setVersions((m) => ({ ...m, [vid]: r.version }))).catch((e) => setError(e)));
  }, [idx, pages, versions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' && pages[idx + 1]) setPageId(pages[idx + 1].id);
      if (e.key === 'ArrowLeft' && pages[idx - 1]) setPageId(pages[idx - 1].id);
      if (e.key === 'Escape') { if (menu) setMenu(false); else nav(-1); }
      if (e.key === '1') setDevice('MOBILE'); if (e.key === '2') setDevice('TABLET'); if (e.key === '3') setDevice('DESKTOP');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, pages, menu, nav]);

  const download = async (kind: 'png' | 'html' | 'zip-html' | 'zip-react') => {
    if (!project) return;
    setBusy(kind); setError(null);
    try {
      if (kind === 'png' || kind === 'html') {
        if (!version) return;
        await api.download('GET', `/versions/${version.id}/download?format=${kind}`, undefined, `${project.name}-${page?.name ?? 'screen'}.${kind}`);
      } else {
        const format = kind === 'zip-react' ? 'react' : 'html';
        const report = await api.download('POST', `/projects/${project.id}/export`, { format, idempotencyKey: newKey() }, `${project.name}-${format}.zip`);
        if (report?.warnings?.length) toast('info', `Exported with ${report.warnings.length} warning(s).`);
        refresh().catch(() => undefined);
      }
      toast('success', 'Download started');
      setMenu(false);
    } catch (e) { setError(e as ApiError); setMenu(false); } finally { setBusy(null); }
  };

  const d = DEVICES.find((x) => x.id === device)!;
  const reactOk = !!me?.plan.features.includes('react_export');

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink-50 dark:bg-ink-950">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white/80 px-3 py-2 backdrop-blur dark:border-ink-800 dark:bg-ink-900/80 sm:px-5">
        <button onClick={() => nav(-1)} className="rounded-xl p-2 hover:bg-ink-100 dark:hover:bg-ink-800" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 sm:flex-none sm:w-56">
          <p className="truncate font-semibold">{project?.name ?? 'Preview'}</p>
          <p className="muted truncate text-xs">{page ? `${page.name} · ${idx + 1}/${pages.length}` : '—'} · {d.w} × {d.h}</p>
        </div>
        <div role="tablist" aria-label="Device" className="order-3 mx-auto flex w-full rounded-2xl bg-ink-100 p-1 dark:bg-ink-800 sm:order-none sm:w-auto">
          {DEVICES.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={device === id} onClick={() => setDevice(id)}
              className={cx('relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition sm:flex-none', device === id ? 'text-white' : 'muted hover:text-ink-900 dark:hover:text-white')}>
              {device === id && <motion.span layoutId="devpill" className="absolute inset-0 rounded-xl bg-forge-500 shadow" transition={{ type: 'spring', damping: 22, stiffness: 300 }} />}
              <Icon className="relative h-4 w-4" /><span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to={`/studio/${projectId}`} className="hidden items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-850 dark:hover:bg-ink-800 sm:inline-flex"><Pencil className="h-4 w-4" />Edit</Link>
          <div className="relative">
            <Button size="sm" variant="ember" icon={<Download className="h-4 w-4" />} onClick={() => setMenu((m) => !m)}>Download</Button>
            <AnimatePresence>
              {menu && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  className="absolute right-0 top-11 z-50 w-80 space-y-1 rounded-2xl border border-ink-200 bg-white p-2 shadow-xl dark:border-ink-700 dark:bg-ink-900">
                  <div className="flex items-center justify-between px-2 py-1"><span className="text-sm font-semibold">Download</span><button onClick={() => setMenu(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
                  <MenuItem icon={<ImageIcon className="h-4 w-4" />} title={`Screenshot · ${page?.name ?? 'screen'}`} hint="PNG · free" disabled={!version?.imageUrl} loading={busy === 'png'} onClick={() => download('png')} />
                  <MenuItem icon={<FileCode2 className="h-4 w-4" />} title="This page as .html" hint="Single file · free" disabled={!version} loading={busy === 'html'} onClick={() => download('html')} />
                  <MenuItem icon={<FileArchive className="h-4 w-4" />} title={`Whole ${pages.length > 1 ? `app · ${pages.length} screens` : 'project'}`} hint="HTML/CSS/JS ZIP · 1 credit" disabled={!pages.length} loading={busy === 'zip-html'} onClick={() => download('zip-html')} />
                  <MenuItem icon={<Code2 className="h-4 w-4" />} title="React + TypeScript project" hint={reactOk ? 'Vite ZIP · 2 credits' : 'Pro and above'} disabled={!pages.length || !reactOk} loading={busy === 'zip-react'} onClick={() => download('zip-react')} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {pages.length > 1 && (
        <nav className="flex gap-1.5 overflow-x-auto border-b border-ink-200 px-3 py-2 dark:border-ink-800 sm:px-5" aria-label="Screens">
          {pages.map((p, i) => (
            <button key={p.id} onClick={() => setPageId(p.id)} className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-medium transition', p.id === pageId ? 'bg-forge-500 text-white' : 'surface-2 muted hover:text-ink-900 dark:hover:text-white')}>{i + 1}. {p.name}</button>
          ))}
        </nav>
      )}
      {error && <div className="px-5 pt-3"><ErrorBox error={error} /></div>}

      {/* Device stage */}
      <main className="relative flex min-h-0 flex-1 items-stretch justify-center p-3 sm:p-6">
        {!project ? <div className="h-full w-full max-w-md animate-pulse rounded-3xl bg-ink-200 dark:bg-ink-800" />
          : !pages.length ? <div className="m-auto text-center"><p className="font-semibold">Nothing generated yet</p><Link to={`/studio/${projectId}`} className="text-forge-500 hover:underline">Open the studio</Link></div>
          : (
            <motion.div key={device} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }} className="h-full w-full">
              {/* Preview renders the real device viewport width inside its own phone / tablet / desktop frame, scaled to fit. */}
              {version ? <Preview key={version.id} html={version.html} device={device} zoom="contain" className="h-full items-center !bg-transparent" title={`${page?.name} preview`} />
                : <div className="mx-auto h-full max-w-md animate-pulse rounded-3xl bg-ink-200 dark:bg-ink-800" />}
            </motion.div>
          )}
        {pages.length > 1 && (<>
          <button disabled={idx <= 0} onClick={() => setPageId(pages[idx - 1].id)} aria-label="Previous screen" className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg disabled:opacity-30 dark:bg-ink-800 sm:block"><ChevronLeft className="h-5 w-5" /></button>
          <button disabled={idx >= pages.length - 1} onClick={() => setPageId(pages[idx + 1].id)} aria-label="Next screen" className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg disabled:opacity-30 dark:bg-ink-800 sm:block"><ChevronRight className="h-5 w-5" /></button>
        </>)}
      </main>
    </div>
  );
}

function MenuItem({ icon, title, hint, disabled, loading, onClick }: { icon: React.ReactNode; title: string; hint: string; disabled?: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled || loading} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-ink-800">
      <span className="text-forge-500">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="muted block text-xs">{loading ? 'Preparing…' : hint}</span></span>
    </button>
  );
}
