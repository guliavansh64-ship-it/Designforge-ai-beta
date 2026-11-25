import { useEffect, useRef, useState } from 'react';
import { Send, Bot, User2, Code2, Copy, Paperclip, Layers, Image as ImageIcon, Type, Trash2, CopyPlus, RotateCcw, GitCompare, CheckCircle2, XCircle } from 'lucide-react';
import { api, newKey, ApiError } from '../../lib/api';
import { useApi, timeAgo } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import type { QualityAudit, VersionListItem } from '../../lib/types';
import type { PreviewHandle, Selection } from '../Preview';
import { Badge, Button, ErrorBox, ScoreRing, cx } from '../ui';

/* ───────────── Properties panel: real edits to the selected element ───────────── */
const rgbToHex = (c: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c);
  if (!m || m[4] === '0') return '#ffffff';
  return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
};
export function PropertiesPanel({ sel, preview, readOnly }: { sel: Selection | null; preview: React.RefObject<PreviewHandle>; readOnly: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => setText(sel?.text ?? ''), [sel?.path, sel?.text]);
  if (!sel) return <p className="muted p-4 text-sm">Click any element in the preview to edit its text, colours, typography and spacing.</p>;
  const set = (prop: string, v: string) => preview.current?.setStyle(sel.path, prop, v);
  const num = (v: string) => parseFloat(v) || 0;
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-center justify-between"><Badge tone="forge">&lt;{sel.tag}&gt;</Badge>{sel.section && <span className="muted truncate text-xs">in {sel.section}</span>}</div>
      {readOnly && <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-300">View-only access.</p>}
      <fieldset disabled={readOnly} className="space-y-4 disabled:opacity-60">
        {sel.leaf && (
          <div>
            <label className="label" htmlFor="ptext">Text</label>
            <textarea id="ptext" className="field min-h-[72px]" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== sel.text && preview.current?.setText(sel.path, text)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Text colour</span><input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-ink-200 bg-transparent dark:border-ink-700" defaultValue={rgbToHex(sel.styles.color)} key={'c' + sel.path} onChange={(e) => set('color', e.target.value)} /></label>
          <label className="block"><span className="label">Background</span><input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-ink-200 bg-transparent dark:border-ink-700" defaultValue={rgbToHex(sel.styles.backgroundColor)} key={'b' + sel.path} onChange={(e) => set('background-color', e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Font size (px)</span><input type="number" min={8} max={160} className="field" defaultValue={num(sel.styles.fontSize)} key={'fs' + sel.path} onChange={(e) => set('font-size', e.target.value + 'px')} /></label>
          <label className="block"><span className="label">Weight</span>
            <select className="field" defaultValue={sel.styles.fontWeight} key={'fw' + sel.path} onChange={(e) => set('font-weight', e.target.value)}>{[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={String(w)}>{w}</option>)}</select></label>
          <label className="block"><span className="label">Line height</span><input className="field" defaultValue={sel.styles.lineHeight} key={'lh' + sel.path} onBlur={(e) => set('line-height', e.target.value)} /></label>
          <label className="block"><span className="label">Letter spacing</span><input className="field" defaultValue={sel.styles.letterSpacing} key={'ls' + sel.path} onBlur={(e) => set('letter-spacing', e.target.value)} /></label>
        </div>
        <div>
          <span className="label">Align</span>
          <div className="grid grid-cols-4 gap-1">{['left', 'center', 'right', 'justify'].map((a) => <button key={a} onClick={() => set('text-align', a)} className={cx('rounded-lg border px-2 py-1.5 text-xs capitalize', sel.styles.textAlign === a ? 'border-forge-500 bg-forge-500/10' : 'border-ink-200 dark:border-ink-700')}>{a}</button>)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Padding</span><input className="field" defaultValue={sel.styles.padding} key={'p' + sel.path} onBlur={(e) => set('padding', e.target.value)} /></label>
          <label className="block"><span className="label">Margin</span><input className="field" defaultValue={sel.styles.margin} key={'m' + sel.path} onBlur={(e) => set('margin', e.target.value)} /></label>
          <label className="col-span-2 block"><span className="label">Corner radius (px)</span><input type="range" min={0} max={48} defaultValue={num(sel.styles.borderRadius)} key={'r' + sel.path} onChange={(e) => set('border-radius', e.target.value + 'px')} className="w-full accent-forge-500" /></label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<CopyPlus className="h-3.5 w-3.5" />} onClick={() => preview.current?.duplicate(sel.path)}>Duplicate</Button>
          <Button size="sm" variant="secondary" className="!text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => preview.current?.remove(sel.path)}>Delete</Button>
        </div>
      </fieldset>
    </div>
  );
}

/* ───────────── Theme: global colour & font replacement + sections/images ───────────── */
const FONTS = ['Inter', 'Poppins', 'DM Sans', 'Manrope', 'Plus Jakarta Sans', 'Playfair Display', 'Space Grotesk', 'Outfit', 'Lora', 'system-ui'];
export function ThemePanel({ theme, preview, readOnly, onAskAI }: { theme: { colors: string[]; fonts: string[]; sections: { path: string; label: string; tag: string }[]; images: { path: string; src: string; alt: string }[] } | null; preview: React.RefObject<PreviewHandle>; readOnly: boolean; onAskAI: (section: string) => void }) {
  if (!theme) return <p className="muted p-4 text-sm">Loading design tokens…</p>;
  return (
    <div className="space-y-6 p-4 text-sm">
      <div>
        <span className="label">Colour palette (click to replace everywhere)</span>
        <div className="grid grid-cols-6 gap-2">
          {theme.colors.map((c) => (
            <label key={c} className="group relative" title={c}>
              <span className="block aspect-square rounded-lg ring-1 ring-black/10" style={{ background: c }} />
              <input disabled={readOnly} type="color" defaultValue={c} className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => preview.current?.replaceColor(c, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Typography</span>
        <p className="muted mb-2 text-xs">Detected: {theme.fonts.join(', ')}</p>
        <select disabled={readOnly} className="field" defaultValue="" onChange={(e) => e.target.value && preview.current?.replaceFont(e.target.value)}>
          <option value="">Replace font family…</option>{FONTS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <p className="muted mt-1 text-[11px]">Web fonts other than system fonts need a matching &lt;link&gt; in export; Stitch designs usually include Google Fonts already.</p>
      </div>
      <div>
        <span className="label flex items-center gap-1"><Layers className="h-3.5 w-3.5" />Sections</span>
        <ul className="space-y-1">
          {theme.sections.map((s) => (
            <li key={s.path} className="surface-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <Badge>{s.tag}</Badge><span className="flex-1 truncate text-xs">{s.label}</span>
              {!readOnly && <button onClick={() => onAskAI(s.label)} className="text-[11px] font-medium text-forge-500 hover:underline">Regenerate</button>}
              {!readOnly && <button onClick={() => preview.current?.remove(s.path)} aria-label={`Delete ${s.label}`} className="muted hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      </div>
      {theme.images.length > 0 && (
        <div>
          <span className="label flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" />Images</span>
          <div className="grid grid-cols-3 gap-2">{theme.images.map((im) => <img key={im.path} src={im.src} alt={im.alt} className="aspect-square rounded-lg object-cover ring-1 ring-black/10" />)}</div>
          <p className="muted mt-1 text-[11px]">To swap an image, select it and ask the AI ("replace the hero image with a photo of…") or edit the src in export.</p>
        </div>
      )}
    </div>
  );
}

/* ───────────── Versions + compare ───────────── */
const SRC_LABEL: Record<string, string> = { stitch_generate: 'Generated', stitch_edit: 'AI edit', stitch_variant: 'Variant', manual_edit: 'Manual edit', improve: 'Improved', template: 'Template', logo: 'Logo' };
export function VersionsPanel({ projectId, pageId, currentId, onOpen, onCompare, onRestore, refreshKey, readOnly }: { projectId: string; pageId: string; currentId?: string; onOpen: (v: VersionListItem) => void; onCompare: (a: string, b: string) => void; onRestore: (vid: string) => void; refreshKey: number; readOnly: boolean }) {
  const { data, loading } = useApi<{ versions: VersionListItem[] }>(`/projects/${projectId}/versions?pageId=${pageId}&limit=50`, [refreshKey]);
  const [pick, setPick] = useState<string | null>(null);
  if (loading && !data) return <p className="muted p-4 text-sm">Loading versions…</p>;
  const versions = data?.versions ?? [];
  return (
    <div className="p-3">
      <p className="muted mb-2 px-1 text-xs">History is append-only — restoring creates a new version. {pick ? 'Pick a second version to compare.' : ''}</p>
      <ul className="space-y-1.5">
        {versions.map((v) => (
          <li key={v.id} className={cx('rounded-xl border p-2.5 text-xs transition', v.id === currentId ? 'border-forge-500/60 bg-forge-500/5' : 'border-transparent hover:border-ink-200 dark:hover:border-ink-800', pick === v.id && 'ring-2 ring-ember-500')}>
            <div className="flex items-center gap-2">
              <Badge tone={v.id === currentId ? 'forge' : 'neutral'}>{SRC_LABEL[v.source] ?? v.source}</Badge>
              {v.audit && <span className="font-semibold">{v.audit.score}</span>}
              <span className="muted ml-auto">{timeAgo(v.createdAt)}</span>
            </div>
            {v.prompt && <p className="muted mt-1 line-clamp-2">{v.prompt}</p>}
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => onOpen(v)} className="font-medium text-forge-500 hover:underline">Preview</button>
              <span className="muted">·</span>
              <button onClick={() => { if (!pick) setPick(v.id); else { onCompare(pick, v.id); setPick(null); } }} className="inline-flex items-center gap-1 font-medium hover:underline"><GitCompare className="h-3 w-3" />{pick === v.id ? 'Selected' : 'Compare'}</button>
              {v.id !== currentId && !readOnly && (<><span className="muted">·</span><button onClick={() => onRestore(v.id)} className="inline-flex items-center gap-1 font-medium hover:underline"><RotateCcw className="h-3 w-3" />Restore</button></>)}
            </div>
          </li>
        ))}
      </ul>
      {!versions.length && <p className="muted p-2 text-sm">No versions yet.</p>}
    </div>
  );
}

/* ───────────── Audit checklist ───────────── */
export function AuditPanel({ audit, onReaudit, onImprove, readOnly }: { audit?: QualityAudit; onReaudit: () => void; onImprove: () => void; readOnly: boolean }) {
  if (!audit) return <div className="p-4"><p className="muted text-sm">No audit yet for this version.</p><Button className="mt-3" size="sm" variant="secondary" onClick={onReaudit}>Run audit (free)</Button></div>;
  const failed = audit.checks.filter((c) => !c.passed);
  return (
    <div className="p-4 text-sm">
      <div className="flex items-center gap-3"><ScoreRing score={audit.score} /><div><p className="font-semibold">DesignForge heuristic score</p><p className="muted text-xs">{audit.checks.length - failed.length}/{audit.checks.length} automated checks pass</p></div></div>
      <p className="muted mt-3 text-[11px] leading-relaxed">{(audit as any).methodology ?? 'Severity-weighted share of automated checks that pass. Not an industry-standard metric — use it as a checklist, not a verdict.'}</p>
      <ul className="mt-4 space-y-1.5">
        {[...failed, ...audit.checks.filter((c) => c.passed)].map((c) => (
          <li key={c.id} className="flex gap-2 rounded-lg p-1.5 text-xs">
            {c.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className={cx('h-4 w-4 shrink-0', c.severity === 'high' ? 'text-red-500' : 'text-amber-500')} />}
            <div><p className={cx(c.passed && 'muted')}>{c.label}</p>{!c.passed && <p className="muted mt-0.5">{c.detail}</p>}</div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2"><Button size="sm" variant="secondary" onClick={onReaudit}>Re-run</Button>{!readOnly && failed.length > 0 && <Button size="sm" onClick={onImprove}>Fix with AI</Button>}</div>
    </div>
  );
}

/* ───────────── Chat assistant ───────────── */
interface Msg { id: string; role: 'user' | 'assistant'; text: string; code?: string; codeLang?: string; jobId?: string; createdAt: number }
export function ChatPanel({ projectId, pageId, deviceType, model, onJob, readOnly }: { projectId: string; pageId: string; deviceType: string; model: string; onJob: (jobId: string) => void; readOnly: boolean }) {
  const toast = useToast();
  const { data, reload, setData } = useApi<{ messages: Msg[] }>(`/projects/${projectId}/chat`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [img, setImg] = useState<{ b64: string; ext: string; name: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [data?.messages.length]);

  const send = async () => {
    if (text.trim().length < 2) return;
    setBusy(true); setError(null);
    const optimistic: Msg = { id: 'tmp' + Date.now(), role: 'user', text, createdAt: Date.now() };
    setData((d) => ({ messages: [...(d?.messages ?? []), optimistic] }));
    try {
      const r = await api.post<{ job?: { id: string }; message: Msg }>(`/projects/${projectId}/chat`, { message: text, pageId, deviceType, model, idempotencyKey: newKey(), ...(img ? { imageBase64: img.b64, imageExt: img.ext } : {}) });
      setText(''); setImg(null);
      if (r.job) onJob(r.job.id);
      await reload();
    } catch (e) { setError(e as ApiError); reload(); } finally { setBusy(false); }
  };
  const attach = (f?: File) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('error', 'Max 5 MB');
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return toast('error', 'PNG, JPG or WEBP only');
    const r = new FileReader();
    r.onload = () => setImg({ b64: String(r.result).split(',')[1], ext, name: f.name });
    r.readAsDataURL(f);
  };
  const SUGGEST = ['Make this design more premium', 'Improve the mobile layout', 'Change the colour theme to deep green', 'Add a pricing section', 'Create a matching About page', 'Show me 3 variations', 'Convert this to React'];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!data?.messages.length && <p className="muted p-2 text-xs">Ask for changes in plain language. Edits run in your Stitch account and create a new version you can undo. "Convert to React" is free and runs locally.</p>}
        {data?.messages.map((m) => (
          <div key={m.id} className={cx('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <div className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full', m.role === 'user' ? 'bg-ink-200 dark:bg-ink-800' : 'bg-forge-gradient text-white')}>{m.role === 'user' ? <User2 className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}</div>
            <div className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-forge-500 text-white' : 'surface-2')}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.code && (
                <div className="mt-2 overflow-hidden rounded-lg bg-ink-950 text-ink-100">
                  <div className="flex items-center justify-between border-b border-ink-800 px-2 py-1 text-[11px]"><span className="flex items-center gap-1"><Code2 className="h-3 w-3" />{m.codeLang}</span><button onClick={() => { navigator.clipboard.writeText(m.code!); toast('success', 'Copied'); }} className="flex items-center gap-1 hover:text-white"><Copy className="h-3 w-3" />Copy</button></div>
                  <pre className="max-h-64 overflow-auto p-2 font-mono text-[11px] leading-relaxed">{m.code}</pre>
                </div>
              )}
              <p className={cx('mt-1 text-[10px]', m.role === 'user' ? 'text-white/70' : 'muted')}>{timeAgo(m.createdAt)}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="border-t border-ink-200 p-3 dark:border-ink-800">
        <ErrorBox error={error} className="mb-2 !p-3 !text-xs" />
        {!readOnly && <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">{SUGGEST.map((s) => <button key={s} onClick={() => setText(s)} className="surface-2 shrink-0 rounded-full px-2.5 py-1 text-[11px] muted hover:text-ink-900 dark:hover:text-white">{s}</button>)}</div>}
        {img && <div className="mb-2 flex items-center gap-2 text-xs"><Badge tone="forge"><ImageIcon className="h-3 w-3" />{img.name}</Badge><button onClick={() => setImg(null)} className="muted">remove</button></div>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
          <label className={cx('cursor-pointer rounded-lg p-2 muted hover:text-ink-900 dark:hover:text-white', readOnly && 'pointer-events-none opacity-40')} title="Attach a reference screenshot">
            <Paperclip className="h-4 w-4" /><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => attach(e.target.files?.[0])} />
          </label>
          <textarea disabled={readOnly} rows={1} className="field max-h-32 min-h-[40px] resize-none" placeholder={readOnly ? 'View-only — only the owner can run AI edits' : 'Describe a change…'} value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button type="submit" size="sm" className="!h-10 !w-10 !p-0" loading={busy} disabled={readOnly || text.trim().length < 2} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
        <p className="muted mt-1.5 flex items-center gap-1 text-[10px]"><Type className="h-3 w-3" />AI edits use 2 credits (refunded on failure) and your Stitch quota.</p>
      </div>
    </div>
  );
}
