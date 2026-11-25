import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileCode2, Atom, Download, CheckCircle2, AlertTriangle, Lock, Info, Figma } from 'lucide-react';
import { CREDIT_COSTS } from '@designforge/shared';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Project } from '../lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, cx } from '../components/ui';

interface Report { files: number; assetsDownloaded: number; assetsFailed: string[]; warnings: string[]; errors: string[] }

export default function ExportCenter() {
  const [params] = useSearchParams();
  const { me, refresh } = useAuth();
  const toast = useToast();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=50');
  const [pid, setPid] = useState(params.get('project') ?? '');
  const [format, setFormat] = useState<'html' | 'react'>('html');
  const [pages, setPages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const exportable = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo' && p.pages.some((x) => x.currentVersionId));
  const project = exportable.find((p) => p.id === pid);
  const reactOk = me?.plan.features.includes('react_export');
  useEffect(() => { setPages(project?.pages.filter((x) => x.currentVersionId).map((x) => x.id) ?? []); setReport(null); }, [project?.id]);

  const run = async () => {
    setBusy(true); setErr(null); setReport(null);
    try {
      const r = await api.download('POST', `/projects/${pid}/export`, { format, pageIds: pages, idempotencyKey: newKey() }, `${project?.name ?? 'export'}-${format}.zip`);
      setReport(r ?? null); toast('success', 'Export downloaded.'); refresh();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  const formats = [
    { id: 'html' as const, icon: FileCode2, title: 'HTML / CSS / JS', body: 'Static site: one HTML file per page, shared assets, README. Opens in any browser; deploy to any static host.', cost: CREDIT_COSTS.html_export, locked: false },
    { id: 'react' as const, icon: Atom, title: 'React + TypeScript (Vite)', body: 'A runnable Vite project: one component per page, router, Tailwind preserved, strict TS. Type-checked before you are charged.', cost: CREDIT_COSTS.react_export, locked: !reactOk },
  ];

  return (
    <div>
      <PageHeader title="Export Center" subtitle="Download production-ready code. Exports are validated first — you're only charged if the build check passes." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="p-5 sm:p-6">
          <label className="label" htmlFor="ep">Project</label>
          <select id="ep" className="field" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Select a project…</option>{exportable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>

          <span className="label mt-6">Format</span>
          <div className="grid gap-3 sm:grid-cols-2">{formats.map((f) => (
            <button key={f.id} disabled={f.locked} onClick={() => setFormat(f.id)} className={cx('focus-ring relative rounded-2xl border p-4 text-left transition disabled:opacity-50', format === f.id ? 'border-forge-500 bg-forge-500/5' : 'border-ink-200 dark:border-ink-700')}>
              <f.icon className="h-6 w-6 text-forge-500" /><p className="mt-3 font-medium">{f.title}</p><p className="muted mt-1 text-xs">{f.body}</p>
              <p className="mt-3 text-xs font-medium">{f.cost} credit{f.cost > 1 ? 's' : ''}</p>{f.locked && <Lock className="absolute right-3 top-3 h-4 w-4 muted" />}
            </button>
          ))}</div>

          {project && (<>
            <span className="label mt-6">Pages</span>
            <div className="flex flex-wrap gap-2">{project.pages.filter((x) => x.currentVersionId).map((pg) => (
              <label key={pg.id} className={cx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', pages.includes(pg.id) ? 'border-forge-500 bg-forge-500/5' : 'border-ink-200 dark:border-ink-700')}>
                <input type="checkbox" className="accent-forge-500" checked={pages.includes(pg.id)} onChange={(e) => setPages(e.target.checked ? [...pages, pg.id] : pages.filter((x) => x !== pg.id))} />{pg.name}
              </label>
            ))}</div>
          </>)}
          <ErrorBox error={err} className="mt-5" />
          <div className="mt-6 flex justify-end"><Button size="lg" loading={busy} disabled={!project || !pages.length} onClick={run} icon={<Download className="h-4 w-4" />}>Build & download</Button></div>

          {report && (
            <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Validation passed · {report.files} files · {report.assetsDownloaded} images bundled</p>
              {report.warnings.length > 0 && <div className="mt-3"><p className="flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Warnings</p>{report.warnings.map((w) => <p key={w} className="muted text-xs">• {w}</p>)}</div>}
              {report.assetsFailed.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs text-forge-500">{report.assetsFailed.length} images kept as remote URLs</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-3 font-mono text-[11px] text-ink-200">{report.assetsFailed.join('\n')}</pre></details>}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5 text-sm">
            <p className="mb-2 font-medium">What's validated</p>
            <ul className="muted space-y-1.5 text-xs"><li>• HTML parses and every page has a title & viewport</li><li>• Inline event handlers & script injection removed</li><li>• No API keys or secrets in output (scanned)</li><li>• React: every component type-checked with the TypeScript compiler</li><li>• Relative links between pages rewritten</li></ul>
            <p className="muted mt-3 text-xs">Run <code className="rounded bg-ink-100 px-1 dark:bg-ink-850">npm install && npm run build</code> in the React export to build it locally.</p>
          </Card>
          <Card className="flex gap-3 p-5 text-xs">
            <Figma className="h-5 w-5 shrink-0 muted" />
            <div><p className="font-medium">Figma</p><p className="muted mt-1">No direct Figma export: neither Stitch's public SDK nor Figma's public API offers a reliable import path we can build on today. Stitch's own web app offers "Copy to Figma" for designs in your Stitch account.</p></div>
          </Card>
          <p className="flex gap-2 text-[11px] muted"><Info className="h-3.5 w-3.5 shrink-0" />Designs you generate are yours to use, subject to Google's terms for Stitch output and any third-party images/fonts referenced.</p>
          {!reactOk && <Badge tone="amber">React export: Pro and above</Badge>}
        </div>
      </div>
    </div>
  );
}
