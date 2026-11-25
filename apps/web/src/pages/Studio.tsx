import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Smartphone, Tablet, Monitor, Undo2, Redo2, ZoomIn, Download, Share2, Sparkles, Wand2, Shuffle, Plus, MessageSquare,
  SlidersHorizontal, Palette, History, ClipboardCheck, Check, Loader2, CloudOff, Eye, Pencil, X, MoreHorizontal, Trash2, Lock,
} from 'lucide-react';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useJob } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { GenerationJob, ProjectVersion, ProjectWithAccess, QualityAudit, VersionListItem } from '../lib/types';
import { Preview, type Device, type PreviewHandle, type Selection } from '../components/Preview';
import { AuditPanel, ChatPanel, PropertiesPanel, ThemePanel, VersionsPanel } from '../components/studio/Panels';
import { JobProgress } from '../components/JobProgress';
import { Badge, Button, ErrorBox, Modal, ScoreRing, Spinner, Tabs, cx } from '../components/ui';

type LeftTab = 'theme' | 'versions';
type RightTab = 'ai' | 'props' | 'chat' | 'audit';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export default function Studio() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me, refresh: refreshMe } = useAuth();
  const preview = useRef<PreviewHandle>(null);

  const [project, setProject] = useState<ProjectWithAccess | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [version, setVersion] = useState<ProjectVersion | null>(null);
  const [html, setHtml] = useState('');
  const [device, setDevice] = useState<Device>('DESKTOP');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [sel, setSel] = useState<Selection | null>(null);
  const [theme, setTheme] = useState<Parameters<typeof ThemePanel>[0]['theme']>(null);
  const [left, setLeft] = useState<LeftTab>('theme');
  const [right, setRight] = useState<RightTab>('ai');
  const [save, setSave] = useState<SaveState>('saved');
  const [undo, setUndo] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(params.get('job'));
  const [versionsKey, setVersionsKey] = useState(0);
  const [compare, setCompare] = useState<{ a: ProjectVersion; b: ProjectVersion } | null>(null);
  const [viewing, setViewing] = useState<ProjectVersion | null>(null);
  const [variants, setVariants] = useState<ProjectVersion[] | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [mobilePanel, setMobilePanel] = useState<'none' | 'left' | 'right'>('none');
  const [editMode, setEditMode] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const readOnly = project?.access === 'viewer';
  const isOwner = project?.access === 'owner';
  const page = project?.pages.find((p) => p.id === pageId);

  // ── load project
  const loadProject = useCallback(async () => {
    try {
      const { project: p } = await api.get<{ project: ProjectWithAccess }>(`/projects/${projectId}`);
      setProject(p);
      setDevice((d) => (p.deviceType === 'AGNOSTIC' ? d : (p.deviceType as Device)));
      setPageId((cur) => (cur && p.pages.some((x) => x.id === cur) ? cur : p.pages[0]?.id ?? null));
      return p;
    } catch (e) { setLoadErr(e as ApiError); }
  }, [projectId]);
  useEffect(() => {
    loadProject();
    const pp = sessionStorage.getItem(`df_pending_pages_${projectId}`);
    if (pp) setPending(JSON.parse(pp));
  }, [loadProject, projectId]);

  // ── load page head version
  const loadVersion = useCallback(async (vid?: string) => {
    if (!vid) { setVersion(null); setHtml(''); return; }
    const { version: v } = await api.get<{ version: ProjectVersion }>(`/versions/${vid}`);
    setVersion(v);
    const draft = localStorage.getItem(`df_draft_${v.id}`);
    setHtml(draft ?? v.html);
    if (draft) { setSave('dirty'); toast('info', 'Recovered unsaved edits from this device.', { label: 'Discard', onClick: () => { localStorage.removeItem(`df_draft_${v.id}`); setHtml(v.html); setSave('saved'); } }); }
    else setSave('saved');
    setUndo([]); setRedo([]); setSel(null);
  }, [toast]);
  useEffect(() => { loadVersion(page?.currentVersionId); }, [page?.currentVersionId, loadVersion]);

  // ── jobs
  const job = useJob(jobId, async (j: GenerationJob) => {
    await Promise.all([loadProject(), refreshMe()]);
    setVersionsKey((k) => k + 1);
    if (j.status === 'succeeded') {
      if (j.type === 'variants' && j.resultVersionIds?.length) {
        const vs = await Promise.all(j.resultVersionIds.map((id) => api.get<{ version: ProjectVersion }>(`/versions/${id}`).then((r) => r.version)));
        setVariants(vs);
      } else toast('success', j.type === 'improve' ? 'Improvement finished — see before/after in Versions.' : 'Design updated.');
      const p = await loadProject();
      if (j.type === 'generate' && p) { const last = p.pages[p.pages.length - 1]; if (last && last.id !== pageId && !params.get('job')) setPageId(last.id); }
    } else if (j.status === 'failed') toast('error', j.error?.message ?? 'Generation failed. Credits refunded.');
    if (params.get('job')) { params.delete('job'); setParams(params, { replace: true }); }
  });
  const running = job && !['succeeded', 'failed', 'cancelled'].includes(job.status);

  // ── edits → undo stack + autosave
  const onChange = useCallback(() => {
    setSave('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const next = await preview.current!.serialize();
        setUndo((u) => [...u.slice(-49), html]);
        setRedo([]);
        if (version) localStorage.setItem(`df_draft_${version.id}`, next);
        setHtml(next);
        await persist(next);
      } catch { setSave('error'); }
    }, 1800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, version]);

  const persist = async (doc: string) => {
    if (!project || !pageId || readOnly) return;
    setSave('saving');
    try {
      const { version: v } = await api.post<{ version: ProjectVersion }>(`/projects/${project.id}/pages/${pageId}/save`, { html: doc, parentVersionId: version?.id, note: 'Editor changes' });
      if (version) localStorage.removeItem(`df_draft_${version.id}`);
      setVersion(v);
      setProject((p) => p && { ...p, pages: p.pages.map((x) => (x.id === pageId ? { ...x, currentVersionId: v.id } : x)) });
      setSave('saved'); setVersionsKey((k) => k + 1);
    } catch (e) { setSave('error'); toast('error', `Autosave failed: ${(e as Error).message}. Your edits are kept on this device.`); }
  };

  const doUndo = () => { if (!undo.length) return; setRedo((r) => [html, ...r]); const prev = undo[undo.length - 1]; setUndo((u) => u.slice(0, -1)); setHtml(prev); persist(prev); };
  const doRedo = () => { if (!redo.length) return; setUndo((u) => [...u, html]); const nxt = redo[0]; setRedo((r) => r.slice(1)); setHtml(nxt); persist(nxt); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save === 'dirty' || save === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  // ── AI actions
  const [aiPrompt, setAiPrompt] = useState('');
  const [section, setSection] = useState('');
  const [model, setModel] = useState<'GEMINI_3_FLASH' | 'GEMINI_3_1_PRO'>('GEMINI_3_FLASH');
  const [aiErr, setAiErr] = useState<ApiError | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const run = async (path: string, body: Record<string, unknown>) => {
    setAiBusy(true); setAiErr(null);
    try {
      const r = await api.post<{ job: GenerationJob }>(`/projects/${project!.id}/${path}`, { ...body, model, deviceType: device, idempotencyKey: newKey() });
      setJobId(r.job.id); refreshMe();
      return true;
    } catch (e) { setAiErr(e as ApiError); return false; } finally { setAiBusy(false); }
  };
  const generatePage = async (name: string, prompt?: string) => {
    const ok = await run('generate', { prompt: prompt ?? `Create the "${name}" page for this ${project?.kind === 'website' ? 'website' : 'app'}. Match the visual style, colours, typography and navigation of the existing "${project?.pages[0]?.name}" page.`, newPageName: name });
    if (ok) { const rest = pending.filter((p) => p !== name); setPending(rest); sessionStorage.setItem(`df_pending_pages_${project!.id}`, JSON.stringify(rest)); }
  };

  const openCompare = async (a: string, b: string) => {
    const [va, vb] = await Promise.all([a, b].map((id) => api.get<{ version: ProjectVersion }>(`/versions/${id}`).then((r) => r.version)));
    setCompare(va.createdAt <= vb.createdAt ? { a: va, b: vb } : { a: vb, b: va });
  };
  const restore = async (vid: string) => {
    try { const { version: v } = await api.post<{ version: ProjectVersion }>(`/versions/${vid}/restore`); toast('success', 'Restored as a new version.'); await loadProject(); setProject((p) => p && { ...p, pages: p.pages.map((x) => (x.id === v.pageId ? { ...x, currentVersionId: v.id } : x)) }); setVersionsKey((k) => k + 1); setVariants(null); setViewing(null); }
    catch (e) { toast('error', (e as Error).message); }
  };
  const reaudit = async () => {
    if (!version) return;
    try { const { audit } = await api.post<{ audit: QualityAudit }>(`/versions/${version.id}/audit`); setVersion({ ...version, audit }); } catch (e) { toast('error', (e as Error).message); }
  };
  const rename = async (name: string) => {
    if (!project || !name.trim() || name === project.name) return;
    try { await api.patch(`/projects/${project.id}`, { name }); setProject({ ...project, name }); } catch (e) { toast('error', (e as Error).message); }
  };
  const addPage = async () => {
    const name = window.prompt('New page name', `Page ${(project?.pages.length ?? 0) + 1}`);
    if (!name) return;
    try { const r = await api.post<{ page: { id: string } }>(`/projects/${project!.id}/pages`, { name }); await loadProject(); if (r.page) setPageId(r.page.id); } catch (e) { toast('error', (e as Error).message); }
  };
  const deletePage = async (pid: string) => {
    if (!window.confirm('Delete this page? Its versions remain in history.')) return;
    try { await api.del(`/projects/${project!.id}/pages/${pid}`); await loadProject(); } catch (e) { toast('error', (e as Error).message); }
  };

  const stitchOk = me?.connections.find((c) => c.provider === 'stitch')?.connected;
  const quickEdits = useMemo(() => ['Make it feel more premium and spacious', 'Improve visual hierarchy of headings', 'Use a dark theme with the same layout', 'Make buttons larger and more prominent', 'Improve the mobile layout'], []);

  if (loadErr) return <div className="p-8"><ErrorBox error={loadErr} /><Link to="/projects" className="mt-4 inline-block text-sm text-forge-500">← Back to projects</Link></div>;
  if (!project) return <div className="grid h-full place-items-center"><Spinner className="h-8 w-8" /></div>;

  const leftPanel = (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-200 p-3 dark:border-ink-800">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide muted">Pages</span>{!readOnly && <button onClick={addPage} className="rounded p-1 muted hover:text-forge-500" aria-label="Add page"><Plus className="h-4 w-4" /></button>}</div>
        <ul className="space-y-0.5">
          {project.pages.map((p) => (
            <li key={p.id} className="group flex items-center">
              <button onClick={() => setPageId(p.id)} className={cx('flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-sm', p.id === pageId ? 'bg-forge-500/10 font-medium text-forge-600 dark:text-forge-200' : 'hover:bg-ink-100 dark:hover:bg-ink-850')}>
                {p.name}{!p.currentVersionId && <span className="muted ml-1 text-[10px]">(empty)</span>}
              </button>
              {isOwner && project.pages.length > 1 && <button onClick={() => deletePage(p.id)} className="invisible p-1 muted hover:text-red-500 group-hover:visible" aria-label={`Delete ${p.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
        {pending.length > 0 && isOwner && (
          <div className="mt-3 rounded-xl border border-dashed border-forge-500/40 p-2">
            <p className="mb-1.5 text-[11px] muted">Planned pages — generate in the same style:</p>
            {pending.map((p) => <button key={p} disabled={!!running} onClick={() => generatePage(p)} className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs hover:bg-forge-500/10 disabled:opacity-40"><Sparkles className="h-3 w-3 text-forge-500" />{p}</button>)}
          </div>
        )}
      </div>
      <Tabs className="m-3" value={left} onChange={setLeft} items={[{ id: 'theme', label: 'Design', icon: <Palette className="h-3.5 w-3.5" /> }, { id: 'versions', label: 'Versions', icon: <History className="h-3.5 w-3.5" /> }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {left === 'theme' ? <ThemePanel theme={theme} preview={preview} readOnly={readOnly || !editMode} onAskAI={(s) => { setSection(s); setRight('ai'); setMobilePanel('right'); }} />
          : pageId && <VersionsPanel projectId={project.id} pageId={pageId} currentId={page?.currentVersionId} refreshKey={versionsKey} readOnly={readOnly}
            onOpen={async (v: VersionListItem) => setViewing((await api.get<{ version: ProjectVersion }>(`/versions/${v.id}`)).version)} onCompare={openCompare} onRestore={restore} />}
      </div>
    </div>
  );

  const rightPanel = (
    <div className="flex h-full flex-col">
      <Tabs className="m-3" value={right} onChange={setRight} items={[{ id: 'ai', label: 'AI', icon: <Sparkles className="h-3.5 w-3.5" /> }, { id: 'props', label: 'Edit', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> }, { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> }, { id: 'audit', label: 'Audit', icon: <ClipboardCheck className="h-3.5 w-3.5" /> }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {right === 'props' && <PropertiesPanel sel={sel} preview={preview} readOnly={readOnly || !editMode} />}
        {right === 'chat' && pageId && <ChatPanel projectId={project.id} pageId={pageId} deviceType={device} model={model} onJob={setJobId} readOnly={!isOwner} />}
        {right === 'audit' && <AuditPanel audit={version?.audit} onReaudit={reaudit} readOnly={!isOwner} onImprove={() => run('improve', { pageId, autoIterate: false, maxIterations: 1 })} />}
        {right === 'ai' && (
          <div className="space-y-5 p-4 text-sm">
            {!isOwner && <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"><Lock className="h-4 w-4 shrink-0" />AI actions run on the project owner's own Stitch account, so only the owner can use them. You can still {readOnly ? 'view and export' : 'edit manually'}.</p>}
            {isOwner && !stitchOk && <ErrorBox error={Object.assign(new Error('Connect your Stitch account to use AI edits.'), { action: 'open_integrations' }) as any} />}
            <fieldset disabled={!isOwner || !stitchOk || !!running} className="space-y-5 disabled:opacity-50">
              <div>
                <label className="label" htmlFor="aip">{page?.currentVersionId ? 'Describe a change' : 'Describe this page'}</label>
                {section && <div className="mb-2 flex items-center gap-1 text-xs"><Badge tone="forge">Section: {section}</Badge><button onClick={() => setSection('')} aria-label="Clear section"><X className="h-3 w-3" /></button></div>}
                <textarea id="aip" className="field min-h-[96px]" maxLength={4000} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={page?.currentVersionId ? 'e.g. Replace the hero with a split layout and a product screenshot' : 'What should this page contain?'} />
                <div className="mt-2 flex flex-wrap gap-1.5">{quickEdits.map((q) => <button key={q} type="button" onClick={() => setAiPrompt(q)} className="surface-2 rounded-full px-2.5 py-1 text-[11px] muted hover:text-ink-900 dark:hover:text-white">{q}</button>)}</div>
              </div>
              <label className="flex items-center justify-between text-xs"><span className="muted">Model</span>
                <select className="field !w-auto !py-1.5 !text-xs" value={model} onChange={(e) => setModel(e.target.value as any)}>
                  <option value="GEMINI_3_FLASH">Gemini 3 Flash</option><option value="GEMINI_3_1_PRO" disabled={!me?.plan.features.includes('pro_model')}>Gemini 3.1 Pro {me?.plan.features.includes('pro_model') ? '' : '(Premium)'}</option>
                </select></label>
              <ErrorBox error={aiErr} className="!p-3 !text-xs" />
              {page?.currentVersionId ? (
                <div className="grid gap-2">
                  <Button loading={aiBusy} disabled={aiPrompt.trim().length < 3} onClick={async () => { if (await run('edit', { prompt: aiPrompt, pageId, section: section || undefined })) setAiPrompt(''); }} icon={<Wand2 className="h-4 w-4" />}>Apply edit · 2 cr</Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={!me?.plan.features.includes('variants')} onClick={() => run('variants', { prompt: aiPrompt || 'Explore alternative layouts and visual treatments', pageId, count: 3, creativeRange: 'EXPLORE' })} icon={<Shuffle className="h-4 w-4" />}>Variants · 4</Button>
                    <Button variant="secondary" onClick={() => run('improve', { pageId, instructions: aiPrompt || undefined, autoIterate: false, maxIterations: 1 })} icon={<Sparkles className="h-4 w-4" />}>Improve · 3</Button>
                  </div>
                </div>
              ) : <Button loading={aiBusy} disabled={aiPrompt.trim().length < 5} onClick={() => run('generate', { prompt: aiPrompt, pageId })} icon={<Sparkles className="h-4 w-4" />}>Generate page</Button>}
            </fieldset>
            {version?.audit && <div className="surface-2 flex items-center gap-3 rounded-xl p-3"><ScoreRing score={version.audit.score} size={44} /><div className="text-xs"><p className="font-medium">Heuristic checks</p><button onClick={() => setRight('audit')} className="text-forge-500 hover:underline">View checklist →</button></div></div>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200 bg-white px-2 dark:border-ink-850 dark:bg-ink-950 sm:px-3">
        <button onClick={() => nav('/projects')} className="focus-ring rounded-lg p-2 muted hover:text-ink-900 dark:hover:text-white" aria-label="Back to projects"><ArrowLeft className="h-4 w-4" /></button>
        <input defaultValue={project.name} key={project.name} onBlur={(e) => rename(e.target.value)} disabled={!isOwner} aria-label="Project name" className="min-w-0 max-w-[180px] truncate rounded-lg bg-transparent px-2 py-1 font-display text-sm font-semibold hover:bg-ink-100 focus:bg-ink-100 focus:outline-none dark:hover:bg-ink-850 dark:focus:bg-ink-850 sm:max-w-xs" />
        <span className="hidden items-center gap-1 text-xs muted sm:flex" aria-live="polite">
          {save === 'saved' && <><Check className="h-3.5 w-3.5 text-emerald-500" />Saved</>}
          {save === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</>}
          {save === 'dirty' && <>Unsaved</>}
          {save === 'error' && <><CloudOff className="h-3.5 w-3.5 text-red-500" />Not saved</>}
        </span>
        {project.access !== 'owner' && <Badge tone="amber">{project.access}</Badge>}
        <div className="flex-1" />
        <div className="hidden items-center rounded-xl bg-ink-100 p-1 dark:bg-ink-850 md:flex" role="group" aria-label="Device">
          {([['DESKTOP', Monitor], ['TABLET', Tablet], ['MOBILE', Smartphone]] as const).map(([d, I]) => (
            <button key={d} onClick={() => setDevice(d)} aria-pressed={device === d} aria-label={d.toLowerCase()} className={cx('rounded-lg p-1.5', device === d ? 'bg-white shadow-sm dark:bg-ink-700' : 'muted')}><I className="h-4 w-4" /></button>
          ))}
        </div>
        <label className="hidden items-center gap-1 text-xs muted lg:flex"><ZoomIn className="h-4 w-4" />
          <select value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))} className="rounded-lg bg-transparent py-1 text-xs focus:outline-none" aria-label="Zoom">
            <option value="fit">Fit</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option>
          </select></label>
        <div className="flex items-center">
          <button onClick={doUndo} disabled={!undo.length || readOnly} className="rounded-lg p-2 muted hover:text-ink-900 disabled:opacity-30 dark:hover:text-white" aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></button>
          <button onClick={doRedo} disabled={!redo.length || readOnly} className="rounded-lg p-2 muted hover:text-ink-900 disabled:opacity-30 dark:hover:text-white" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 className="h-4 w-4" /></button>
        </div>
        <button onClick={() => setEditMode((m) => !m)} className={cx('hidden rounded-lg p-2 sm:block', editMode ? 'text-forge-500' : 'muted')} aria-label={editMode ? 'Switch to interact mode' : 'Switch to edit mode'} title={editMode ? 'Edit mode: click selects elements' : 'Preview mode'}>{editMode ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        {isOwner && <Button size="sm" variant="ghost" className="hidden sm:inline-flex" icon={<Share2 className="h-4 w-4" />} onClick={() => setShareOpen(true)}>Share</Button>}
        <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => nav(`/exports?project=${project.id}`)}><span className="hidden sm:inline">Export</span></Button>
        <button className="rounded-lg p-2 muted xl:hidden" onClick={() => setMobilePanel(mobilePanel === 'right' ? 'none' : 'right')} aria-label="Tools"><MoreHorizontal className="h-4 w-4" /></button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white dark:border-ink-850 dark:bg-ink-950 lg:block">{leftPanel}</aside>
        <div className="relative min-w-0 flex-1 bg-ink-100 dark:bg-ink-900">
          {page?.currentVersionId && html ? (
            <Preview ref={preview} html={html} device={device} zoom={zoom} editable={editMode && !readOnly}
              onSelect={(s) => { setSel(s); setRight('props'); }} onTheme={setTheme} onChange={onChange} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              {running ? <div className="w-full max-w-lg">{job && <JobProgress job={job} />}</div> : (
                <div><Sparkles className="mx-auto h-8 w-8 text-forge-400" /><p className="mt-3 font-display font-semibold">This page is empty</p><p className="muted mt-1 text-sm">Describe it in the AI panel to generate it with Stitch.</p></div>
              )}
            </div>
          )}
          <AnimatePresence>
            {job && page?.currentVersionId && (running || job.status === 'failed' || job.type === 'improve') && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-2xl">
                <JobProgress job={job} compact={job.type !== 'improve'} onClose={() => setJobId(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <aside className="hidden w-80 shrink-0 border-l border-ink-200 bg-white dark:border-ink-850 dark:bg-ink-950 xl:block">{rightPanel}</aside>
        {/* mobile/tablet drawers */}
        <AnimatePresence>
          {mobilePanel !== 'none' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 bg-ink-950/50 xl:hidden" onClick={() => setMobilePanel('none')}>
              <motion.aside initial={{ x: 340 }} animate={{ x: 0 }} exit={{ x: 340 }} onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 right-0 flex w-[min(340px,100%)] flex-col bg-white dark:bg-ink-950">
                <div className="flex border-b border-ink-200 dark:border-ink-800">
                  <button onClick={() => setMobilePanel('left')} className={cx('flex-1 py-2.5 text-xs font-medium', mobilePanel === 'left' && 'border-b-2 border-forge-500')}>Pages & design</button>
                  <button onClick={() => setMobilePanel('right')} className={cx('flex-1 py-2.5 text-xs font-medium', mobilePanel === 'right' && 'border-b-2 border-forge-500')}>AI & edit</button>
                </div>
                <div className="min-h-0 flex-1">{mobilePanel === 'left' ? leftPanel : rightPanel}</div>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Compare modal */}
      <Modal open={!!compare} onClose={() => setCompare(null)} title="Compare versions" wide>
        {compare && (
          <div>
            <div className="grid gap-3 md:grid-cols-2">
              {[compare.a, compare.b].map((v, i) => (
                <div key={v.id}>
                  <div className="mb-2 flex items-center gap-2 text-sm"><Badge tone={i ? 'forge' : 'neutral'}>{i ? 'After' : 'Before'}</Badge><span className="muted truncate text-xs">{v.prompt}</span>{v.audit && <span className="ml-auto font-semibold">{v.audit.score}</span>}</div>
                  <div className="h-[360px] overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800"><Preview html={v.html} device={device} zoom="fit" title={i ? 'After' : 'Before'} /></div>
                </div>
              ))}
            </div>
            {compare.a.audit && compare.b.audit && (() => {
              const before = new Map(compare.a.audit!.checks.map((c) => [c.id, c.passed]));
              const fixed = compare.b.audit!.checks.filter((c) => c.passed && before.get(c.id) === false);
              const reg = compare.b.audit!.checks.filter((c) => !c.passed && before.get(c.id) === true);
              return (
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl bg-emerald-500/10 p-3"><p className="font-medium text-emerald-700 dark:text-emerald-300">Fixed ({fixed.length})</p>{fixed.map((c) => <p key={c.id} className="text-xs">✓ {c.label}</p>)}</div>
                  <div className="rounded-xl bg-red-500/10 p-3"><p className="font-medium text-red-700 dark:text-red-300">Regressed ({reg.length})</p>{reg.map((c) => <p key={c.id} className="text-xs">✗ {c.label}</p>)}</div>
                </div>
              );
            })()}
            {!readOnly && <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => restore(compare.a.id)}>Restore “before”</Button><Button onClick={() => restore(compare.b.id)}>Restore “after”</Button></div>}
          </div>
        )}
      </Modal>

      {/* Single version viewer */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Version preview" wide>
        {viewing && <><div className="h-[460px] overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800"><Preview html={viewing.html} device={device} zoom="fit" /></div>
          {!readOnly && viewing.id !== page?.currentVersionId && <div className="mt-4 flex justify-end"><Button onClick={() => restore(viewing.id)} icon={<History className="h-4 w-4" />}>Restore this version</Button></div>}</>}
      </Modal>

      {/* Variants picker */}
      <Modal open={!!variants} onClose={() => setVariants(null)} title="Choose a variation" wide>
        {variants && <div className="grid gap-3 md:grid-cols-3">{variants.map((v, i) => (
          <div key={v.id} className="surface-2 rounded-xl p-2">
            <div className="h-64 overflow-hidden rounded-lg"><Preview html={v.html} device={device} zoom="fit" title={`Variation ${i + 1}`} /></div>
            <div className="mt-2 flex items-center justify-between"><span className="text-sm font-medium">Variation {i + 1}{v.audit && <span className="muted"> · {v.audit.score}</span>}</span><Button size="sm" onClick={() => restore(v.id)}>Use this</Button></div>
          </div>
        ))}</div>}
        <p className="muted mt-3 text-xs">Unchosen variations stay in Versions and can be promoted later.</p>
      </Modal>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} project={project} onChanged={loadProject} />
    </div>
  );
}

function ShareModal({ open, onClose, project, onChanged }: { open: boolean; onClose: () => void; project: ProjectWithAccess; onChanged: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const submit = async (r: 'viewer' | 'editor' | 'none', e = email) => {
    setBusy(true); setErr(null);
    try { await api.post(`/projects/${project.id}/share`, { email: e, role: r }); toast('success', r === 'none' ? 'Access removed' : `Shared with ${e}`); setEmail(''); onChanged(); }
    catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  };
  const count = Object.keys(project.sharedWith ?? {}).length;
  return (
    <Modal open={open} onClose={onClose} title="Share project">
      <p className="muted mb-4 text-sm">Invite another DesignForge user by their Google email. Viewers can view and export; editors can also make manual edits. AI actions always stay with you (they use your Stitch account).</p>
      <div className="flex gap-2"><input className="field" type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="field !w-28" value={role} onChange={(e) => setRole(e.target.value as any)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></div>
      <ErrorBox error={err} className="mt-3" />
      <div className="mt-4 flex items-center justify-between"><span className="muted text-xs">{count} collaborator{count === 1 ? '' : 's'}</span>
        <div className="flex gap-2"><Button variant="ghost" disabled={!email} onClick={() => submit('none')}>Remove access</Button><Button loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email)} onClick={() => submit(role)}>Share</Button></div></div>
    </Modal>
  );
}
