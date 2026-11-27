import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Plus, FolderKanban, Sparkles, Globe, PenTool, Wand2, MoreVertical, Copy, Archive, ArchiveRestore, Trash2, Folder, Pencil, Download, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useDebounced, timeAgo } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Project } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Modal, PageHeader, Skeleton, Tabs, cx } from '../components/ui';
import { projectLink } from './Dashboard';

const KIND = { ui: { icon: Sparkles, label: 'App UI', tone: 'from-forge-500/25' }, website: { icon: Globe, label: 'Website', tone: 'from-sky-500/25' }, logo: { icon: PenTool, label: 'Brand', tone: 'from-ember-500/25' }, improve: { icon: Wand2, label: 'Improve', tone: 'from-emerald-500/25' } } as const;

export default function Projects() {
  const nav = useNavigate();
  const toast = useToast();
  const [scope, setScope] = useState<'mine' | 'shared' | 'archived'>('mine');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState<'updated' | 'created' | 'name'>('updated');
  const dq = useDebounced(q, 350);
  const qs = new URLSearchParams({ limit: '24', sort, ...(dq && { q: dq }), ...(kind && { kind }), ...(folder && { folder }), ...(scope === 'archived' && { archived: 'true' }), ...(scope === 'shared' && { shared: 'true' }) }).toString();
  const { data, loading, error, reload, setData } = useApi<{ projects: Project[]; nextCursor: string | null }>(`/projects?${qs}`);
  const folders = useApi<{ folders: string[] }>('/folders');
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [moving, setMoving] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [val, setVal] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => { const c = () => setMenu(null); window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast('success', ok); reload(); folders.reload(); } catch (e) { toast('error', (e as Error).message); } };
  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setMore(true);
    try { const r = await api.get<{ projects: Project[]; nextCursor: string | null }>(`/projects?${qs}&cursor=${data.nextCursor}`); setData({ projects: [...data.projects, ...r.projects], nextCursor: r.nextCursor }); } finally { setMore(false); }
  };

  return (
    <div>
      <PageHeader title="My Projects" subtitle="Everything you've generated, improved and edited. Versions are kept for every change." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/studio')}>New project</Button>} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs value={scope} onChange={setScope} items={[{ id: 'mine', label: 'My projects' }, { id: 'shared', label: 'Shared with me', icon: <Users className="h-3.5 w-3.5" /> }, { id: 'archived', label: 'Archived' }]} />
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" /><input className="field !pl-9" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></div>
        <div className="flex gap-2">
          <select className="field !w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">All types</option><option value="ui">App UI</option><option value="website">Website</option><option value="logo">Brand</option><option value="improve">Improve</option></select>
          {scope === 'mine' && <select className="field !w-auto" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder"><option value="">All folders</option>{folders.data?.folders.map((f) => <option key={f}>{f}</option>)}</select>}
          <select className="field !w-auto" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort" disabled={!!dq}><option value="updated">Last edited</option><option value="created">Created</option><option value="name">Name</option></select>
        </div>
      </div>
      <ErrorBox error={error} className="mb-4" />
      {loading && !data ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        : !data?.projects.length ? <Empty icon={<FolderKanban className="h-6 w-6" />} title={dq ? 'No matches' : scope === 'shared' ? 'Nothing shared with you yet' : scope === 'archived' ? 'No archived projects' : 'No projects yet'} body={scope === 'mine' && !dq ? 'Create your first design or start from a template.' : undefined} action={scope === 'mine' && !dq ? <Button onClick={() => nav('/studio')} icon={<Sparkles className="h-4 w-4" />}>Create a design</Button> : undefined} />
        : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.projects.map((p, i) => {
              const K = KIND[p.kind];
              const mine = scope !== 'shared';
              return (
                <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="relative">
                  <Link to={projectLink(p)} className="focus-ring surface group block overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:shadow-glow">
                    <div className={cx('relative grid h-28 place-items-center bg-gradient-to-br to-transparent', K.tone)}>
                      <K.icon className="h-8 w-8 text-ink-700/60 dark:text-white/60" />
                      {p.folder && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-ink-700 dark:bg-ink-900/80 dark:text-ink-200"><Folder className="h-3 w-3" />{p.folder}</span>}
                    </div>
                    <div className="p-4">
                      <p className="truncate font-medium">{p.name}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs muted"><Badge>{K.label}</Badge>{p.pages.length} {p.kind === 'logo' ? 'concepts' : 'pages'} · {timeAgo(p.updatedAt)}</div>
                    </div>
                  </Link>
                  {mine && (
                    <div className="absolute right-2 top-2">
                      <button onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }} className="rounded-lg bg-white/80 p-1.5 text-ink-700 backdrop-blur hover:bg-white dark:bg-ink-900/80 dark:text-ink-200" aria-label={`Actions for ${p.name}`}><MoreVertical className="h-4 w-4" /></button>
                      {menu === p.id && (
                        <div onClick={(e) => e.stopPropagation()} className="surface absolute right-0 top-9 z-20 w-48 rounded-xl p-1 text-sm shadow-2xl">
                          {[
                            { i: Pencil, l: 'Rename', f: () => { setRenaming(p); setVal(p.name); } },
                            { i: Copy, l: 'Duplicate', f: () => act(() => api.post(`/projects/${p.id}/duplicate`), 'Duplicated') },
                            { i: Folder, l: 'Move to folder', f: () => { setMoving(p); setVal(p.folder ?? ''); } },
                            { i: Download, l: 'Export', f: () => nav(`/exports?project=${p.id}`) },
                            p.archived ? { i: ArchiveRestore, l: 'Restore', f: () => act(() => api.patch(`/projects/${p.id}`, { archived: false }), 'Restored') } : { i: Archive, l: 'Archive', f: () => act(() => api.patch(`/projects/${p.id}`, { archived: true }), 'Archived') },
                            { i: Trash2, l: 'Delete', f: () => setDeleting(p), danger: true },
                          ].map((a) => <button key={a.l} onClick={() => { setMenu(null); a.f(); }} className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-ink-100 dark:hover:bg-ink-850', (a as any).danger && 'text-red-600')}><a.i className="h-4 w-4" />{a.l}</button>)}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      {data?.nextCursor && <div className="mt-6 text-center"><Button variant="secondary" loading={more} onClick={loadMore}>Load more</Button></div>}

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename project">
        <form onSubmit={(e) => { e.preventDefault(); const p = renaming!; setRenaming(null); act(() => api.patch(`/projects/${p.id}`, { name: val }), 'Renamed'); }}>
          <input autoFocus className="field" value={val} maxLength={80} onChange={(e) => setVal(e.target.value)} /><div className="mt-4 flex justify-end"><Button disabled={!val.trim()}>Save</Button></div>
        </form>
      </Modal>
      <Modal open={!!moving} onClose={() => setMoving(null)} title="Move to folder">
        <form onSubmit={(e) => { e.preventDefault(); const p = moving!; setMoving(null); act(() => api.patch(`/projects/${p.id}`, { folder: val.trim() }), val.trim() ? `Moved to ${val.trim()}` : 'Removed from folder'); }}>
          <input autoFocus list="folders" className="field" placeholder="Folder name (empty = none)" value={val} maxLength={60} onChange={(e) => setVal(e.target.value)} />
          <datalist id="folders">{folders.data?.folders.map((f) => <option key={f} value={f} />)}</datalist>
          <div className="mt-4 flex justify-end"><Button>Move</Button></div>
        </form>
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete project?">
        <p className="text-sm">“{deleting?.name}” and all its versions, chat history and exports will be permanently deleted from Designo. The linked project in your Stitch account is not touched.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={() => { const p = deleting!; setDeleting(null); act(() => api.del(`/projects/${p.id}`), 'Deleted'); }}>Delete permanently</Button></div>
      </Modal>
    </div>
  );
}
