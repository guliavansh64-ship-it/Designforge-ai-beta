import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { showAlert, toast } from '../../components/Dialog';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Smartphone, Tablet, Monitor, Wand2, Shuffle, Sparkles, History, Download, ClipboardCheck, CheckCircle2, XCircle, X, Lock, Maximize2, Image as ImageIcon, FileCode2 } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useJob, timeAgo } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Job, Project, Version } from '../../lib/types';
import { HtmlPreview } from '../../components/HtmlPreview';
import { JobCard } from '../../components/JobCard';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../../components/ui';
import { Animated, Appear, CountUp, Float, PressScale, SkeletonList, Swap, popIn } from '../../components/motion';
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
const SRC: Record<string, string> = { stitch_generate: 'Generated', stitch_edit: 'AI edit', stitch_variant: 'Variant', manual_edit: 'Manual', improve: 'Improved', template: 'Template' };

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
  const page = project?.pages.find((p) => p.id === pageId);
  const isOwner = project?.access === 'owner';

  const load = useCallback(async () => {
    try {
      const { project: p } = await api.get<{ project: Project & { access: string } }>(`/projects/${id}`);
      setProject(p);
      setPageId((cur) => (cur && p.pages.some((x) => x.id === cur) ? cur : p.pages.find((x) => x.currentVersionId)?.id ?? p.pages[0]?.id ?? null));
      if (p.deviceType !== 'AGNOSTIC') setDevice((d) => (p.deviceType as any) ?? d);
    } catch (e) { setErr(e as ApiError); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
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
  const doExport = async (format: 'html' | 'react') => {
    setBusy(format); setErr(null);
    try { await api.downloadAndShare('POST', `/projects/${id}/export`, { format, idempotencyKey: newKey() }, `${project?.name ?? 'export'}-${format}.zip`); refresh(); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const downloadOne = async (format: 'png' | 'html') => {
    if (!version) return;
    setBusy(format); setErr(null);
    const base = `${project?.name ?? 'design'}-${page?.name ?? 'screen'}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    try { await api.downloadAndShare('GET', `/versions/${version.id}/download?format=${format}`, null, `${base}.${format}`, format === 'png' ? 'image/png' : 'text/html'); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const reaudit = async () => {
    if (!version) return;
    try { const { audit } = await api.post<{ audit: Version['audit'] }>(`/versions/${version.id}/audit`); setVersion({ ...version, audit }); } catch (e) { setErr(e as ApiError); }
  };

  if (!project) return <View style={{ padding: 16, gap: 12 }}>{err ? <ErrorBox error={err} /> : <SkeletonList rows={3} />}</View>;
  const stitchOk = me?.connections.find((x) => x.provider === 'stitch')?.connected;

  return (
    <>
      <Stack.Screen options={{ title: project.name }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        {project.pages.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{project.pages.map((p) => <Chip key={p.id} label={p.name + (p.currentVersionId ? '' : ' (empty)')} active={p.id === pageId} onPress={() => setPageId(p.id)} />)}</ScrollView>}
        <Row>
          <View style={{ flex: 1 }}><DeviceSwitch device={device} onChange={setDevice} /></View>
          <PressScale onPress={() => router.push(`/preview/${id}${pageId ? `?page=${pageId}` : ''}`)} disabled={!version} accessibilityLabel="Open full-screen preview"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: version ? c.primary : c.card }}>
            <Maximize2 size={16} color={version ? '#fff' : c.muted} /><T size={13} weight="600" style={{ color: version ? '#fff' : c.muted }}>Full screen</T>
          </PressScale>
        </Row>
        {version ? <Animated.View key={version.id} entering={FadeInDown.springify().damping(18)}><HtmlPreview html={version.html} device={device} /></Animated.View> : (
          <Card style={{ height: 260, alignItems: 'center', justifyContent: 'center', gap: 6 }}><Float><Sparkles color={c.primary} size={28} /></Float><T weight="600">{running ? 'Generating…' : 'This page is empty'}</T><T muted size={13}>{running ? 'Usually 30–120 seconds' : 'Describe it below to generate'}</T></Card>
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
                <Button small variant="secondary" title="Add page" disabled={!!running || !stitchOk || newPage.trim().length < 2} onPress={() => { const n = newPage.trim(); setNewPage(''); run('generate', { prompt: `Create the "${n}" page. Match the visual style, colours, typography and navigation of the "${project.pages[0]?.name}" page.`, newPageName: n }, 'gen'); }} />
              </Row>
            )}
          </Card>
        </Swap>)}

        {tab === 'versions' && (<Swap id="versions">
          <View style={{ gap: 8 }}>
            {versions.loading && !versions.data && <SkeletonList rows={3} />}
            {versions.data?.versions.map((v, i) => (
              <Card key={v.id} index={i} style={{ gap: 6, borderColor: v.id === page?.currentVersionId ? c.primary : c.border }}>
                <Row><Badge label={SRC[v.source] ?? v.source} tone={v.id === page?.currentVersionId ? 'primary' : 'neutral'} />{v.audit && <T size={13} weight="600">{v.audit.score}</T>}<T muted size={12} style={{ marginLeft: 'auto' }}>{timeAgo(v.createdAt)}</T></Row>
                {v.prompt && <T muted size={13} numberOfLines={2}>{v.prompt}</T>}
                <Row>
                  <Button small variant="secondary" title="Preview" onPress={async () => setViewing((await api.get<{ version: Version }>(`/versions/${v.id}`)).version)} />
                  {v.id !== page?.currentVersionId && project.access !== 'viewer' && <Button small title={v.source === 'stitch_variant' ? 'Use' : 'Restore'} onPress={() => restore(v.id)} />}
                </Row>
              </Card>
            ))}
            {!versions.data?.versions.length && <T muted>No versions yet.</T>}
          </View>
        </Swap>)}

        {tab === 'audit' && (<Swap id="audit">
          <Card style={{ gap: 8 }}>
            {version?.audit ? (<>
              <Row><Animated.View entering={popIn}><CountUp value={version.audit.score} style={{ color: c.text, fontSize: 28, fontWeight: '800' }} /></Animated.View><View style={{ flex: 1 }}><T weight="600">DesignForge heuristic score</T><T muted size={12}>Share of automated checks passed — a checklist, not an objective rating.</T></View></Row>
              {[...version.audit.checks].sort((a, b) => Number(a.passed) - Number(b.passed)).map((ck, i) => (
                <Appear key={ck.id} index={i}><Row style={{ alignItems: 'flex-start' }}>{ck.passed ? <CheckCircle2 size={16} color={c.green} /> : <XCircle size={16} color={ck.severity === 'high' ? c.red : c.amber} />}<View style={{ flex: 1 }}><T size={13}>{ck.label}</T>{!ck.passed && <T muted size={12}>{ck.detail}</T>}</View></Row></Appear>
              ))}
              <Button small variant="secondary" title="Re-run audit (free)" onPress={reaudit} />
            </>) : <Button small variant="secondary" title="Run audit (free)" disabled={!version} onPress={reaudit} />}
          </Card>
        </Swap>)}

        {tab === 'export' && (<Swap id="export">
          <Card style={{ gap: 12 }}>
            <T weight="600">This page{page ? ` · ${page.name}` : ''}</T>
            <Row>
              <Button style={{ flex: 1 }} small variant="secondary" title="Screenshot PNG" icon={<ImageIcon size={16} color={c.text} />} loading={busy === 'png'} disabled={!version?.imageUrl} onPress={() => downloadOne('png')} />
              <Button style={{ flex: 1 }} small variant="secondary" title=".html file" icon={<FileCode2 size={16} color={c.text} />} loading={busy === 'html'} disabled={!version} onPress={() => downloadOne('html')} />
            </Row>
            <T muted size={11}>Free. Single-page downloads open in Android's share sheet.</T>
            <T weight="600">Whole project{project.pages.filter((x) => x.currentVersionId).length > 1 ? ` · ${project.pages.filter((x) => x.currentVersionId).length} screens` : ''}</T>
            <T muted size={13}>Exports are validated first; you're only charged if the build check passes. The ZIP opens in Android's share sheet (save to Files, Drive, email…).</T>
            <Button title="HTML / CSS / JS · 1 cr" icon={<Download color="#fff" size={18} />} loading={busy === 'html'} disabled={!version} onPress={() => doExport('html')} />
            <Button variant="secondary" title={`React + TypeScript · 2 cr${me?.plan.features.includes('react_export') ? '' : ' 🔒'}`} loading={busy === 'react'} disabled={!version || !me?.plan.features.includes('react_export')} onPress={() => doExport('react')} />
            <T muted size={11}>No Figma export — there's no reliable public API for it.</T>
          </Card>
        </Swap>)}
      </ScrollView>

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
