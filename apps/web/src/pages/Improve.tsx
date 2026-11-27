import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2, Upload, FolderKanban, FileCode2, Image as ImageIcon, ArrowRight, Coins, Info } from 'lucide-react';
import { CREDIT_COSTS } from '@designforge/shared';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useJob } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { GenerationJob, Project, ProjectVersion } from '../lib/types';
import { IMPROVE_STAGES, JobProgress, type ImproveStep } from '../components/JobProgress';
import { Preview } from '../components/Preview';
import { Badge, Button, Card, ErrorBox, PageHeader, Tabs, Toggle, cx } from '../components/ui';

export default function Improve() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [src, setSrc] = useState<'project' | 'upload'>('project');
  const projects = useApi<{ projects: Project[] }>('/projects?limit=50');
  const [projectId, setProjectId] = useState('');
  const [pageId, setPageId] = useState('');
  const [file, setFile] = useState<{ b64: string; ext: string; name: string; size: number } | null>(null);
  const [instructions, setInstructions] = useState('');
  const [auto, setAuto] = useState(false);
  const [maxIt, setMaxIt] = useState(2);
  const [target, setTarget] = useState(90);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [runProject, setRunProject] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: ProjectVersion; after: ProjectVersion; history: ImproveStep[] } | null>(null);

  const canAuto = me?.plan.features.includes('auto_improve');
  const planMax = me?.plan.maxImproveIterations ?? 1;
  const eligible = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo' && p.pages.some((x) => x.currentVersionId));
  const selected = eligible.find((p) => p.id === projectId);

  const job = useJob(jobId, async (j: GenerationJob) => {
    refresh();
    const h = ((j as any).improvementHistory ?? []) as ImproveStep[];
    if (j.status === 'succeeded' && h.length) {
      const [before, after] = await Promise.all([h[0].fromVersionId, h[h.length - 1].toVersionId].map((id) => api.get<{ version: ProjectVersion }>(`/versions/${id}`).then((r) => r.version)));
      setResult({ before, after, history: h });
    } else if (j.status === 'failed') toast('error', j.error?.message ?? 'Improvement failed — credits refunded.');
  });
  const running = job && !['succeeded', 'failed', 'cancelled'].includes(job.status);

  const pick = (f?: File) => {
    if (!f) return;
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!['.html', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return toast('error', 'Upload an .html file or a PNG/JPG/WEBP screenshot.');
    if (f.size > 5 * 1024 * 1024) return toast('error', 'Max 5 MB.');
    const r = new FileReader();
    r.onload = () => setFile({ b64: String(r.result).split(',')[1], ext, name: f.name, size: f.size });
    r.readAsDataURL(f);
  };

  const start = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      let pid = projectId; let pgid = pageId;
      const body: Record<string, unknown> = { instructions: instructions || undefined, autoIterate: auto && canAuto, maxIterations: auto && canAuto ? Math.min(maxIt, planMax) : 1, targetScore: target, idempotencyKey: newKey() };
      if (src === 'upload') {
        if (!file) throw new Error('Choose a file first');
        const { project } = await api.post<{ project: Project }>('/projects', { name: `Improve · ${file.name.replace(/\.[^.]+$/, '')}`.slice(0, 80), kind: 'improve', deviceType: me?.preferences.defaultDevice ?? 'DESKTOP' });
        pid = project.id; pgid = project.pages[0].id;
        Object.assign(body, { importAssetBase64: file.b64, importExt: file.ext });
      }
      const { job: j } = await api.post<{ job: GenerationJob }>(`/projects/${pid}/improve`, { ...body, pageId: pgid });
      setRunProject(pid); setJobId(j.id);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  const itCost = CREDIT_COSTS.improve_iteration;
  return (
    <div>
      <PageHeader eyebrow="Auto Design Improvement" title="Improve an existing design" subtitle="Designo audits the design against a transparent checklist, builds a fix plan, sends targeted instructions to Stitch, then re-audits and shows exactly what changed." />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <Tabs value={src} onChange={setSrc} items={[{ id: 'project', label: 'From a project', icon: <FolderKanban className="h-3.5 w-3.5" /> }, { id: 'upload', label: 'Upload HTML / screenshot', icon: <Upload className="h-3.5 w-3.5" /> }]} />
            <fieldset disabled={!!running} className="mt-5 space-y-4">
              {src === 'project' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Project</span>
                    <select className="field" value={projectId} onChange={(e) => { setProjectId(e.target.value); const p = eligible.find((x) => x.id === e.target.value); setPageId(p?.pages.find((x) => x.currentVersionId)?.id ?? ''); }}>
                      <option value="">Select…</option>{eligible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></label>
                  <label className="block"><span className="label">Page</span>
                    <select className="field" value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={!selected}>
                      {selected?.pages.filter((x) => x.currentVersionId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select></label>
                </div>
              ) : (
                <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-300 p-8 text-center transition hover:border-forge-500 dark:border-ink-700">
                  {file ? (<>{file.ext === '.html' ? <FileCode2 className="h-8 w-8 text-forge-500" /> : <ImageIcon className="h-8 w-8 text-forge-500" />}<p className="mt-2 text-sm font-medium">{file.name}</p><p className="muted text-xs">{(file.size / 1024).toFixed(0)} KB · click to change</p></>)
                    : (<><Upload className="h-8 w-8 muted" /><p className="mt-2 text-sm font-medium">Drop an .html file or a screenshot</p><p className="muted text-xs">PNG, JPG, WEBP or HTML · max 5 MB · imported into your Stitch project with the official upload API</p></>)}
                  <input type="file" className="hidden" accept=".html,image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} />
                </label>
              )}
              <div><label className="label" htmlFor="ins">Your goals (optional)</label>
                <textarea id="ins" className="field min-h-[90px]" maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Make it feel more premium, improve readability on mobile, keep the brand colours" /></div>
              <ErrorBox error={err} />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1 text-xs muted"><Coins className="h-3.5 w-3.5 text-amber-500" />{itCost} credits per iteration · unfinished iterations are refunded</p>
                <Button size="lg" variant="ember" loading={busy} disabled={src === 'project' ? !pageId : !file} onClick={start} icon={<Wand2 className="h-4 w-4" />}>Start improvement</Button>
              </div>
            </fieldset>
          </Card>

          {job && <JobProgress job={job} onClose={() => setJobId(null)} />}

          {result && (
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display font-semibold">Before → after</h2>
                <div className="flex items-center gap-2 text-sm"><Badge>{result.before.audit?.score ?? '—'}</Badge><ArrowRight className="h-4 w-4" /><Badge tone="green">{result.after.audit?.score ?? '—'}</Badge><span className="muted text-xs">heuristic</span></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[result.before, result.after].map((v, i) => <div key={v.id}><p className="mb-1 text-xs font-medium muted">{i ? 'After' : 'Before'}</p><div className="h-80 overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800"><Preview html={v.html} device="DESKTOP" zoom="fit" /></div></div>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => nav(`/studio/${runProject}`)}>Open in editor</Button><Button variant="secondary" onClick={() => nav(`/exports?project=${runProject}`)}>Export</Button></div>
              <p className="muted mt-3 text-xs">Previous versions are kept — you can restore or compare any of them in the editor.</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Auto-iterate</span><Toggle checked={auto && !!canAuto} onChange={(v) => canAuto ? setAuto(v) : nav('/subscription')} label="Auto-iterate" /></div>
            <p className="muted mt-1 text-xs">{canAuto ? 'Repeat audit → fix until the target is reached, the iteration limit is hit, or no further measurable gain.' : 'Available on Pro and above.'}</p>
            <div className={cx('mt-4 space-y-4', !(auto && canAuto) && 'pointer-events-none opacity-40')}>
              <label className="block"><span className="label">Max iterations (your plan: {planMax})</span><input type="range" min={1} max={planMax} value={Math.min(maxIt, planMax)} onChange={(e) => setMaxIt(+e.target.value)} className="w-full accent-forge-500" /><span className="text-sm">{Math.min(maxIt, planMax)} · up to {Math.min(maxIt, planMax) * itCost} credits</span></label>
              <label className="block"><span className="label">Stop at heuristic score</span><input type="range" min={60} max={100} step={5} value={target} onChange={(e) => setTarget(+e.target.value)} className="w-full accent-forge-500" /><span className="text-sm">{target}</span></label>
            </div>
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium">How it works</p>
            <ol className="space-y-1.5 text-xs">{IMPROVE_STAGES.map((s, i) => <li key={s} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-forge-500/15 text-[10px] font-bold text-forge-600 dark:text-forge-300">{i + 1}</span><span className="muted">{s}</span></li>)}</ol>
            <p className="mt-4 flex gap-2 rounded-xl bg-ink-100 p-3 text-[11px] muted dark:bg-ink-850"><Info className="h-3.5 w-3.5 shrink-0" />Scores come from Designo's own automated checks (contrast, headings, landmarks, spacing, breakpoints…). They're a useful checklist, not an objective measure of design quality.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
