import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { showAlert, toast } from '../../components/Dialog';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Smartphone, Tablet, Monitor, Wand2, Shuffle, Sparkles, History, Download, ClipboardCheck, CheckCircle2, XCircle, X, Lock, Maximize2, FileText, Info, Play, Pencil } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useJob, timeAgo } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Job, Project, Version } from '../../lib/types';
import { HtmlPreview } from '../../components/HtmlPreview';
import { JobCard } from '../../components/JobCard';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../../components/ui';
import { Animated, AnimatedProgress, CountUp, Float, PressScale, SkeletonList, Swap, popIn } from '../../components/motion';
import { Logo } from '../../components/Logo';
import { DownloadOptions, DownloadSheet } from '../../components/DownloadOptions';
import { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

/** Segmented device switch with a sliding highlight. */
function DeviceSwitch({ device, onChange }: { device: 'MOBILE' | 'TABLET' | 'DESKTOP'; onChange: (d: 'MOBILE' | 'TABLET' | 'DESKTOP') => void }) {
  const c = useColors();
  const opts = [['MOBILE', Smartphone], ['TABLET', Tablet], ['DESKTOP', Monitor]] as const;
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const idx = opts.findIndex(([d]) => d === device);
  useEffect(() => { x.value = withSpring(idx * (w / 3), { damping: 18, stiffness: 220 }); }, [idx, w, x]);
  const hl = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, padding: 0 }}>
      {w > 0 && <Animated.View style={[{ position: 'absolute', width: w / 3, top: 0, bottom: 0, borderRadius: 12, backgroundColor: c.primary + '2e' }, hl]} />}
      {opts.map(([d, I]) => (
        <PressScale key={d} onPress={() => onChange(d)} scaleTo={0.9} accessibilityLabel={`Preview ${d.toLowerCase()}`} accessibilityState={{ selected: device === d }} style={{ flex: 1, alignItems: 'center', padding: 10 }}>
          <I size={18} color={device === d ? c.primary : c.muted} />
        </PressScale>
      ))}
    </View>
  );
}

type Tab = 'ai' | 'versions' | 'audit' | 'export';
const SRC: Record<string, string> = { stitch_generate: 'Generated', stitch_edit: 'AI edit', stitch_variant: 'Variant', manual_edit: 'Manual', improve: 'Improved', template: 'Template', logo: 'Logo' };
/** Prompts like "create an order page" belong in "Add page", not in an edit of the current page. */
const NEW_PAGE_RE = /\b(create|add|make|build|new)\b[^.]{0,40}\b(page|screen)\b/i;
const scoreTone = (n: number) => (n >= 85 ? 'green' : n >= 60 ? 'amber' : 'red') as 'green' | 'amber' | 'red';

/** Plain-language explanation of what the Audit tab does. */
function AuditHelp() {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ backgroundColor: c.card2, borderRadius: 12, padding: 10, gap: 6 }}>
      <PressScale onPress={() => setOpen((o) => !o)} accessibilityLabel="What is the audit?">
        <Row><Info size={15} color={c.primary} /><T size={13} weight="600" style={{ flex: 1 }}>What does Audit do?</T><T muted size={12}>{open ? 'Hide' : 'Show'}</T></Row>
      </PressScale>
      {open && (
        <View style={{ gap: 4 }}>
          <T size={12} muted>Audit automatically checks the code of this page for common quality and accessibility problems: headings, image descriptions for blind users, tiny text, colour contrast, spacing and labelled buttons and fields.</T>
          <T size={12} muted>• The score is the share of checks passed (100 = all passed).</T>
          <T size={12} muted>• Red = important problem, orange = minor, green = passed.</T>
          <T size={12} muted>• It is free and does not change your design. Use “Fix these with AI” to let Stitch improve the page (3 credits).</T>
          <T size={12} muted>• Each version keeps its own score, so you can compare versions in the Versions tab.</T>
        </View>
      )}
    </View>
  );
}

export default function ProjectScreen() {
  const { id, job: initialJob } = useLocalSearchParams<{ id: string; job?: string }>();
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [project, setProject] = useState<(Project & { access: string }) | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [device, setDevice] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>('MOBILE');
  const [tab, setTab] = useState<Tab>('ai');
  const [prompt, setPrompt] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJob ?? null);
  const [vkey, setVkey] = useState(0);
  const [viewing, setViewing] = useState<Version | null>(null);
  const [newPage, setNewPage] = useState('');
  const [dlOpen, setDlOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const page = project?.pages.find((p) => p.id === pageId);
  const isOwner = project?.access === 'owner';
  const designedCount = project?.pages.filter((x) => x.currentVersionId).length ?? 0;

  const load = useCallback(async () => {
    try {
      const { project: p } = await api.get<{ project: Project & { access: string } }>(`/projects/${id}`);
      setProject(p);
      setPageId((cur) => (cur && p.pages.some((x) => x.id === cur) ? cur : p.pages.find((x) => x.currentVersionId)?.id ?? p.pages[0]?.id ?? null));
      if (p.deviceType !== 'AGNOSTIC') setDevice((d) => (p.deviceType as any) ?? d);
    } catch (e) { setErr(e as ApiError); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Re-attach to a generation that is still running (e.g. the user left this screen and came back
  // from Projects), so the screen shows live progress and pages instead of looking empty.
  useEffect(() => {
    if (jobId) return;
    api.get<{ jobs: Job[] }>(`/projects/${id}/jobs`).then(({ jobs }) => {
      const active = jobs.find((j) => j.status === 'queued' || j.status === 'running');
      if (active) setJobId(active.id);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!page?.currentVersionId) { setVersion(null); return; }
    api.get<{ version: Version }>(`/versions/${page.currentVersionId}`).then((r) => setVersion(r.version)).catch((e) => setErr(e));
  }, [page?.currentVersionId]);

  const versions = useApi<{ versions: Version[] }>(pageId ? `/projects/${id}/versions?pageId=${pageId}&limit=30` : null, [vkey]);
  const job = useJob(jobId, async (j: Job, sawRunning: boolean) => {
    await Promise.all([load(), refresh()]); setVkey((k) => k + 1);
    if (j.status === 'succeeded') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      const multi = (j.resultVersionIds?.length ?? 0) > 1;
      if (j.type !== 'variants') toast(j.type === 'edit' || j.type === 'chat_edit' ? 'Changes applied ✨' : multi ? `Your app is ready — ${j.resultVersionIds!.length} screens ✨` : 'Your design is ready ✨', 'success');
      // A fresh generation opens straight into the full-screen device preview.
      if (j.type === 'generate' && sawRunning) router.push(`/preview/${id}`);
    } else if (j.status === 'failed') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    }
    if (j.status === 'succeeded' && j.type === 'variants' && j.resultVersionIds?.[0]) { setTab('versions'); showAlert('Variations ready', 'Open them in Versions and tap “Use” on your favourite.'); }
  });
  const running = job && !['succeeded', 'failed', 'cancelled'].includes(job.status);
  // Full-app jobs: show each screen as soon as it is ready instead of waiting for the whole app.
  useEffect(() => { if (job?.screensDone) load(); }, [job?.screensDone, load]);

  const run = async (path: string, body: Record<string, unknown>, key: string) => {
    setBusy(key); setErr(null);
    try { const r = await api.post<{ job: Job }>(`/projects/${id}/${path}`, { ...body, deviceType: device, idempotencyKey: newKey() }); setJobId(r.job.id); setPrompt(''); refresh(); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const restore = async (vid: string) => {
    try { await api.post(`/versions/${vid}/restore`); setViewing(null); await load(); setVkey((k) => k + 1); toast('Version restored'); } catch (e) { showAlert('Error', (e as Error).message); }
  };
  const saveRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    setBusy('rename');
    try {
      await api.patch(`/projects/${id}/pages/${renaming.id}`, { name: renaming.name.trim() });
      setRenaming(null); await load(); setVkey((k) => k + 1); toast('Screen renamed');
    } catch (e) { showAlert('Could not rename', (e as Error).message, undefined, 'error'); } finally { setBusy(null); }
  };
  const reaudit = async () => {
    if (!version) return;
    try { const { audit } = await api.post<{ audit: Version['audit'] }>(`/versions/${version.id}/audit`); setVersion({ ...version, audit }); } catch (e) { setErr(e as ApiError); }
  };

  if (!project) return <View style={{ padding: 16, gap: 12 }}>{err ? <ErrorBox error={err} /> : <SkeletonList rows={3} />}</View>;
  const stitchOk = me?.connections.find((x) => x.provider === 'stitch')?.connected;

  return (
    <>
      <Stack.Screen options={{
        title: project.name,
        headerRight: () => (
          <Row gap={4}>
            <PressScale onPress={() => router.push(`/play/${id}${pageId ? `?page=${pageId}` : ''}`)} disabled={!designedCount} accessibilityLabel="Play the app" style={{ padding: 8, borderRadius: 12 }}><Play size={20} color={designedCount ? c.primary : c.muted} fill={designedCount ? c.primary : 'transparent'} /></PressScale>
            <PressScale onPress={() => setDlOpen(true)} accessibilityLabel="Download" style={{ padding: 8, borderRadius: 12 }}><Download size={20} color={c.text} /></PressScale>
          </Row>
        ),
      }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Row gap={6}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>{project.pages.map((p) => <Chip key={p.id} label={p.name + (p.currentVersionId ? '' : ' (empty)')} active={p.id === pageId} onPress={() => setPageId(p.id)} />)}</ScrollView>
          {page && project.access !== 'viewer' && (
            <PressScale onPress={() => setRenaming({ id: page.id, name: page.name })} accessibilityLabel={`Rename ${page.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
              <Pencil size={14} color={c.text} /><T size={12} weight="600">Rename</T>
            </PressScale>
          )}
        </Row>
        <Row>
          <View style={{ flex: 1 }}><DeviceSwitch device={device} onChange={setDevice} /></View>
          <PressScale onPress={() => router.push(`/play/${id}${pageId ? `?page=${pageId}` : ''}`)} disabled={!designedCount} accessibilityLabel="Play the app"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: designedCount ? c.primary : c.card }}>
            <Play size={15} color={designedCount ? '#fff' : c.muted} fill={designedCount ? '#fff' : 'transparent'} /><T size={13} weight="600" style={{ color: designedCount ? '#fff' : c.muted }}>Play</T>
          </PressScale>
          <PressScale onPress={() => router.push(`/preview/${id}${pageId ? `?page=${pageId}` : ''}`)} disabled={!version} accessibilityLabel="Open full-screen preview"
            style={{ padding: 10, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
            <Maximize2 size={16} color={version ? c.text : c.muted} />
          </PressScale>
        </Row>
        {version ? <Animated.View key={version.id} entering={FadeInDown.springify().damping(18)}><HtmlPreview html={version.html} device={device} /></Animated.View> : (
          <Card style={{ height: 280, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {running ? <Logo size={72} /> : <Float><Sparkles color={c.primary} size={28} /></Float>}
            <T weight="700" size={16}>{running ? (job?.screensTotal && job.screensTotal > 1 ? `Designing screen ${Math.min((job.screensDone ?? 0) + 1, job.screensTotal)} of ${job.screensTotal}…` : 'Designing your screen…') : 'This page is empty'}</T>
            <T muted size={13} style={{ textAlign: 'center', paddingHorizontal: 16 }}>{running ? `${job?.progress ?? 0}% · usually 30–120 s per screen. You can leave — we'll notify you.` : 'Describe it below to generate'}</T>
            {running && <View style={{ alignSelf: 'stretch', paddingHorizontal: 24 }}><AnimatedProgress value={job?.progress ?? 0} /></View>}
          </Card>
        )}
        {job && <JobCard job={job} onDismiss={() => setJobId(null)} />}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {([['ai', 'AI edit', Wand2], ['versions', 'Versions', History], ['audit', 'Audit', ClipboardCheck], ['export', 'Export', Download]] as const).map(([t, l]) => <Chip key={t} label={l} active={tab === t} onPress={() => setTab(t)} />)}
        </ScrollView>
        <ErrorBox error={err} />

        {tab === 'ai' && (<Swap id="ai">
          <Card style={{ gap: 12 }}>
            {!isOwner && <Row><Lock size={16} color={c.amber} /><T size={13} muted style={{ flex: 1 }}>AI actions use the owner's own Stitch account, so only the owner can run them.</T></Row>}
            {isOwner && !stitchOk && <ErrorBox error={Object.assign(new Error('Connect your Stitch account to use AI edits.'), { action: 'open_integrations' }) as any} />}
            <Label>{page?.currentVersionId ? 'Describe a change' : 'Describe this page'}</Label>
            <Field multiline value={prompt} onChangeText={setPrompt} maxLength={4000} style={{ minHeight: 100 }} editable={isOwner && !running} placeholder="e.g. Make the header sticky and add a search bar" />
            {isOwner && !!page?.currentVersionId && NEW_PAGE_RE.test(prompt) && (
              <View style={{ backgroundColor: c.primary + '1f', borderRadius: 12, padding: 10, gap: 8 }}>
                <T size={12}>“Apply edit” changes the <T size={12} weight="700">{page.name}</T> page. Want a separate new page instead?</T>
                <Button small variant="secondary" title="Make it a new page" onPress={() => { const m = prompt.match(/\b(?:create|add|make|build|new)\b\s+(?:an?\s+|the\s+)?(?:new\s+)?(.{2,30}?)\s+(?:page|screen)\b/i); setNewPage((m?.[1] ?? 'New').replace(/^\w/, (x) => x.toUpperCase())); }} />
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{['More premium & spacious', 'Improve hierarchy', 'Dark theme', 'Bigger buttons', 'Better mobile layout'].map((s) => <Chip key={s} label={s} onPress={() => setPrompt(s)} />)}</ScrollView>
            {page?.currentVersionId ? (<>
              <Button title="Apply edit · 2 cr" icon={<Wand2 color="#fff" size={18} />} loading={busy === 'edit'} disabled={!isOwner || !stitchOk || !!running || prompt.trim().length < 3} onPress={() => run('edit', { prompt, pageId }, 'edit')} />
              <Row>
                <Button style={{ flex: 1 }} variant="secondary" small title="Variants · 4" icon={<Shuffle size={16} color={c.text} />} loading={busy === 'var'} disabled={!isOwner || !stitchOk || !!running || !me?.plan.features.includes('variants')} onPress={() => run('variants', { prompt: prompt || 'Explore alternative layouts and visual treatments', pageId, count: 3, creativeRange: 'EXPLORE' }, 'var')} />
                <Button style={{ flex: 1 }} variant="secondary" small title="Improve · 3" icon={<Sparkles size={16} color={c.text} />} loading={busy === 'imp'} disabled={!isOwner || !stitchOk || !!running} onPress={() => run('improve', { pageId, instructions: prompt || undefined, autoIterate: false, maxIterations: 1 }, 'imp')} />
              </Row>
            </>) : <Button title="Generate page" icon={<Sparkles color="#fff" size={18} />} loading={busy === 'gen'} disabled={!isOwner || !stitchOk || !!running || prompt.trim().length < 5} onPress={() => run('generate', { prompt, pageId }, 'gen')} />}
            {isOwner && !!page?.currentVersionId && (
              <Row>
                <Field value={newPage} onChangeText={setNewPage} placeholder="New page name (e.g. About)" maxLength={40} style={{ flex: 1 }} />
                <Button small variant="secondary" title="Add page" disabled={!!running || !stitchOk || newPage.trim().length < 2} onPress={() => { const n = newPage.trim(); const extra = prompt.trim(); setNewPage(''); run('generate', { prompt: `Create the "${n}" page.${extra ? ` What it should contain: ${extra}.` : ''} Match the visual style, colours, typography and navigation of the "${project.pages[0]?.name}" page.`, newPageName: n }, 'gen'); }} />
              </Row>
            )}
          </Card>
        </Swap>)}

        {tab === 'versions' && (<Swap id="versions">
          <View style={{ gap: 8 }}>
            {page && (
              <Row style={{ paddingHorizontal: 2 }}>
                <FileText size={16} color={c.primary} />
                <T weight="700" style={{ flex: 1 }} numberOfLines={1}>{page.name}</T>
                <T muted size={12}>{versions.data?.versions.length ? `${versions.data.versions.length} version${versions.data.versions.length > 1 ? 's' : ''}` : ''}</T>
              </Row>
            )}
            {project.pages.length > 1 && <T muted size={12} style={{ paddingHorizontal: 2 }}>Showing the history of this page. Pick another page at the top to see its versions.</T>}
            {versions.loading && !versions.data && <SkeletonList rows={3} />}
            {(() => {
              const list = versions.data?.versions ?? [];
              const num = new Map(list.map((v, i) => [v.id, list.length - i]));
              return list.map((v) => {
                const current = v.id === page?.currentVersionId;
                const restoredFrom = v.prompt?.match(/^Restored (v_[A-Za-z0-9]+)/)?.[1];
                const desc = restoredFrom ? `Restored from version ${num.get(restoredFrom) ?? 'earlier'}` : v.prompt;
                return (
                  <Card key={v.id} style={{ gap: 6, borderColor: current ? c.primary : c.border }}>
                    <Row>
                      <T weight="700" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{page?.name ?? 'Page'} · Version {num.get(v.id)}</T>
                      {current && <Badge label="Current" tone="primary" />}
                      <T muted size={12} style={{ marginLeft: 'auto' }}>{timeAgo(v.createdAt)}</T>
                    </Row>
                    <Row gap={6}>
                      <Badge label={SRC[v.source] ?? v.source} />
                      {v.audit && <Badge label={`Audit ${v.audit.score}/100`} tone={scoreTone(v.audit.score)} />}
                    </Row>
                    {!!desc && <T muted size={13} numberOfLines={2}>{desc}</T>}
                    <Row>
                      <Button small variant="secondary" title="Preview" onPress={async () => setViewing((await api.get<{ version: Version }>(`/versions/${v.id}`)).version)} />
                      {!current && project.access !== 'viewer' && <Button small title={v.source === 'stitch_variant' ? 'Use' : 'Restore'} onPress={() => restore(v.id)} />}
                    </Row>
                  </Card>
                );
              });
            })()}
            {!versions.data?.versions.length && !versions.loading && <T muted>No versions yet.</T>}
          </View>
        </Swap>)}

        {tab === 'audit' && (<Swap id="audit">
          <Card style={{ gap: 8 }}>
            {version?.audit ? (<>
              <Row><Animated.View entering={popIn}><CountUp value={version.audit.score} style={{ color: c[scoreTone(version.audit.score)], fontSize: 28, fontWeight: '800' }} /></Animated.View><View style={{ flex: 1 }}><T weight="600">Quality score{page ? ` · ${page.name}` : ''}</T><T muted size={12}>{version.audit.checks.filter((x) => x.passed).length} of {version.audit.checks.length} checks passed (out of 100).</T></View></Row>
              <AuditHelp />
              {[...version.audit.checks].sort((a, b) => Number(a.passed) - Number(b.passed)).map((ck) => (
                <View key={ck.id}><Row style={{ alignItems: 'flex-start' }}>{ck.passed ? <CheckCircle2 size={16} color={c.green} /> : <XCircle size={16} color={ck.severity === 'high' ? c.red : c.amber} />}<View style={{ flex: 1 }}><T size={13}>{ck.label}</T>{!ck.passed && <T muted size={12}>{ck.detail}</T>}</View></Row></View>
              ))}
              {version.audit.checks.some((x) => !x.passed) && isOwner && (
                <Button small title="Fix these with AI · 3 cr" icon={<Sparkles size={16} color="#fff" />} loading={busy === 'imp'} disabled={!stitchOk || !!running}
                  onPress={() => run('improve', { pageId, instructions: `Fix these audit problems: ${version.audit!.checks.filter((x) => !x.passed).map((x) => x.label).join('; ')}`, autoIterate: false, maxIterations: 1 }, 'imp')} />
              )}
              <Button small variant="secondary" title="Re-run audit (free)" onPress={reaudit} />
            </>) : (<>
              <AuditHelp />
              <Button small variant="secondary" title="Run audit (free)" disabled={!version} onPress={reaudit} />
            </>)}
          </Card>
        </Swap>)}

        {tab === 'export' && (<Swap id="export">
          <Card style={{ gap: 12 }}>
            <DownloadOptions project={project} pageName={page?.name} version={version} />
          </Card>
        </Swap>)}
      </ScrollView>

      <DownloadSheet visible={dlOpen} onClose={() => setDlOpen(false)} project={project} pageName={page?.name} version={version} />
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable onPress={() => setRenaming(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: c.card, borderRadius: 20, padding: 16, gap: 12, borderWidth: 1, borderColor: c.border }}>
            <T weight="700" size={17}>Rename screen</T>
            <Field autoFocus value={renaming?.name ?? ''} onChangeText={(t) => setRenaming((r) => (r ? { ...r, name: t } : r))} maxLength={60} placeholder="e.g. Order history" onSubmitEditing={() => saveRename()} returnKeyType="done" />
            <T muted size={12}>Screen names are used for the Play mode buttons, file names in downloads and the Versions list.</T>
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button small variant="ghost" title="Cancel" onPress={() => setRenaming(null)} />
              <Button small title="Save" disabled={!renaming?.name.trim()} loading={busy === 'rename'} onPress={() => saveRename()} />
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!viewing} animationType="slide" onRequestClose={() => setViewing(null)}>
        <View style={{ flex: 1, backgroundColor: c.bg, padding: 16, gap: 12 }}>
          <Row style={{ justifyContent: 'space-between', marginTop: 24 }}><T weight="700" size={18}>Version preview</T><Pressable onPress={() => setViewing(null)} accessibilityLabel="Close"><X color={c.text} /></Pressable></Row>
          {viewing && <HtmlPreview html={viewing.html} device={device} height={560} />}
          {viewing && viewing.id !== page?.currentVersionId && project.access !== 'viewer' && <Button title="Restore this version" onPress={() => restore(viewing.id)} />}
        </View>
      </Modal>
    </>
  );
}
