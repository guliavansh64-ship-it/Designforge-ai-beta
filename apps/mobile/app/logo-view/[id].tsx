import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, History, Image as ImageIcon, Wand2 } from 'lucide-react-native';
import { FadeIn } from 'react-native-reanimated';
import { api, assetUrl, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useJob } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Project, Version } from '../../lib/types';
import { JobCard } from '../../components/JobCard';
import { saveDownload } from '../../components/DownloadOptions';
import { showAlert, toast } from '../../components/Dialog';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../../components/ui';
import { Animated, PressScale, Skeleton, popIn } from '../../components/motion';

type Bg = 'light' | 'transparent' | 'dark' | 'white';
const BGS: { id: Bg; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'transparent', label: 'Transparent' },
  { id: 'dark', label: 'Dark' },
  { id: 'white', label: 'White' },
];
const IDEAS = ['Make it bolder', 'Simplify the icon', 'Use different colours', 'Rounder, friendlier shapes', 'More premium and elegant', 'Add the brand name under the icon'];
const EDIT_COST = 2;

function useAsset(url?: string) {
  const [uri, setUri] = useState<string>();
  useEffect(() => { let live = true; setUri(undefined); assetUrl(url).then((u) => live && setUri(u)); return () => { live = false; }; }, [url]);
  return uri;
}

/** Checkerboard so the transparent PNG actually reads as transparent. */
function Checker({ size }: { size: number }) {
  const n = 12; const cell = size / n;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap' }} pointerEvents="none">
      {Array.from({ length: n * n }, (_, i) => <View key={i} style={{ width: cell, height: cell, backgroundColor: (Math.floor(i / n) + i) % 2 ? '#e7e7ee' : '#ffffff' }} />)}
    </View>
  );
}

function LogoStage({ v, bg, size }: { v: Version; bg: Bg; size: number }) {
  const a = v.logo?.assets ?? {};
  const pick = bg === 'light' ? v.imageUrl : bg === 'transparent' ? (a.transparent ? `/api/assets/${a.transparent}` : v.imageUrl)
    : bg === 'dark' ? (a.dark ? `/api/assets/${a.dark}` : v.imageUrl) : (a.monoWhite ? `/api/assets/${a.monoWhite}` : v.imageUrl);
  const uri = useAsset(pick);
  const back = bg === 'light' ? '#ffffff' : bg === 'transparent' ? '#ffffff' : bg === 'dark' ? '#0b0b12' : (v.logo?.palette?.[0] ?? '#6a45f0');
  return (
    <View style={{ width: size, height: size, borderRadius: 24, overflow: 'hidden', backgroundColor: back, alignItems: 'center', justifyContent: 'center' }}>
      {bg === 'transparent' && <Checker size={size} />}
      {uri ? (
        <Animated.View key={`${v.id}-${bg}`} entering={FadeIn.duration(260)}>
          <Image source={{ uri }} style={{ width: size * 0.92, height: size * 0.92 }} resizeMode="contain" accessibilityLabel={`Logo, ${bg} background`} />
        </Animated.View>
      ) : <Skeleton width={size * 0.6} height={size * 0.6} radius={16} />}
    </View>
  );
}

function Thumb({ v, active, onPress, label }: { v: Version; active: boolean; onPress: () => void; label: string }) {
  const c = useColors();
  const uri = useAsset(v.imageUrl);
  return (
    <PressScale onPress={onPress} scaleTo={0.92} accessibilityLabel={label} style={{ borderWidth: 2, borderColor: active ? c.primary : c.border, borderRadius: 16, padding: 2 }}>
      {uri ? <Image source={{ uri }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: '#fff' }} resizeMode="contain" /> : <Skeleton width={64} height={64} radius={12} />}
    </PressScale>
  );
}

export default function LogoView() {
  const { id, v: startV } = useLocalSearchParams<{ id: string; v?: string }>();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { me, refresh } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [all, setAll] = useState<Version[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [bg, setBg] = useState<Bg>('light');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const [{ project: p }, { versions }] = await Promise.all([
      api.get<{ project: Project }>(`/projects/${id}`),
      api.get<{ versions: Version[] }>(`/projects/${id}/versions?limit=100`),
    ]);
    setProject(p); setAll(versions.filter((x) => x.source === 'logo'));
    setPageId((cur) => cur ?? versions.find((x) => x.id === startV)?.pageId ?? p.pages.find((pg) => pg.currentVersionId)?.id ?? null);
  }, [id, startV]);
  useEffect(() => { load().catch((e) => setErr(e)); }, [load]);

  /** One entry per concept (page), showing its current head. */
  const concepts = useMemo(() => {
    if (!project) return [] as Version[];
    return project.pages.map((pg) => all.find((x) => x.id === pg.currentVersionId)).filter((x): x is Version => !!x);
  }, [project, all]);
  const idx = Math.max(0, concepts.findIndex((x) => x.pageId === pageId));
  const active = concepts[idx];
  const history = useMemo(() => all.filter((x) => x.pageId === active?.pageId && x.id !== active?.id).sort((a, b) => b.createdAt - a.createdAt), [all, active]);

  const job = useJob(jobId, (j) => {
    refresh();
    if (j.status === 'succeeded') { load().then(() => { toast('Logo updated'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); }); setInstruction(''); }
  });
  const running = !!job && !['succeeded', 'failed', 'cancelled'].includes(job.status);
  const stitch = me?.connections.find((x) => x.provider === 'stitch');
  const credits = me?.credits;

  const go = (d: number) => {
    if (!concepts.length) return;
    const n = (idx + d + concepts.length) % concepts.length;
    setPageId(concepts[n].pageId); setShowHistory(false);
    Haptics.selectionAsync().catch(() => undefined);
  };

  const change = async () => {
    if (!active) return;
    setBusy(true); setErr(null);
    try {
      const { job: j } = await api.post<{ job: { id: string } }>(`/versions/${active.id}/logo-edit`, { instruction: instruction.trim(), idempotencyKey: newKey() });
      setJobId(j.id);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 250);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  const restore = (v: Version) => showAlert('Use this version?', 'This older logo becomes the current one for this concept. Nothing is deleted.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Use it', onPress: async () => { try { await api.post(`/versions/${v.id}/restore`); await load(); toast('Version restored'); } catch (e) { showAlert('Error', (e as Error).message); } } },
  ]);

  const savePng = async () => {
    if (!active) return;
    const a = active.logo?.assets ?? {};
    const asset = bg === 'transparent' ? a.transparent : bg === 'dark' ? a.dark : bg === 'white' ? a.monoWhite : a.light;
    const path = asset ? `/assets/${asset}` : active.imageUrl?.replace(/^\/api/, '');
    if (!path) return;
    try { await saveDownload('GET', path, undefined, `logo-${idx + 1}-${bg}.png`, 'image/png'); } catch (e) { showAlert('Error', (e as Error).message); }
  };

  const stage = Math.min(width - 32, 420);
  const brand = project?.name.replace(/ brand$/i, '') ?? 'Logo';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Row style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 10 }}>
        <PressScale onPress={() => router.back()} accessibilityLabel="Back" style={{ padding: 8, borderRadius: 12, backgroundColor: c.card }}><ArrowLeft size={20} color={c.text} /></PressScale>
        <View style={{ flex: 1 }}>
          <T weight="700" size={17} numberOfLines={1}>{brand}</T>
          <T muted size={12}>{concepts.length ? `Concept ${idx + 1} of ${concepts.length}` : 'Loading…'}</T>
        </View>
        <PressScale onPress={savePng} accessibilityLabel="Save PNG" style={{ padding: 8, borderRadius: 12, backgroundColor: c.card }}><ImageIcon size={20} color={c.text} /></PressScale>
      </Row>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 + insets.bottom }} keyboardShouldPersistTaps="handled">
          <ErrorBox error={!active ? err : null} />
          {!active ? <Skeleton height={stage} radius={24} /> : (
            <>
              <View style={{ alignItems: 'center' }}>
                <LogoStage v={active} bg={bg} size={stage} />
                {concepts.length > 1 && (
                  <>
                    <PressScale onPress={() => go(-1)} accessibilityLabel="Previous concept" style={{ position: 'absolute', left: 6, top: stage / 2 - 20, padding: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)' }}><ChevronLeft size={22} color="#fff" /></PressScale>
                    <PressScale onPress={() => go(1)} accessibilityLabel="Next concept" style={{ position: 'absolute', right: 6, top: stage / 2 - 20, padding: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)' }}><ChevronRight size={22} color="#fff" /></PressScale>
                  </>
                )}
              </View>

              <Row style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
                {BGS.map((b) => <Chip key={b.id} label={b.label} active={bg === b.id} onPress={() => setBg(b.id)} />)}
              </Row>

              {concepts.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
                  {concepts.map((x, i) => <Animated.View key={x.pageId} entering={popIn.delay(i * 60)}><Thumb v={x} label={`Concept ${i + 1}`} active={x.pageId === active.pageId} onPress={() => { setPageId(x.pageId); setShowHistory(false); }} /></Animated.View>)}
                </ScrollView>
              )}

              {/* Change this logo */}
              <Card style={{ gap: 10 }}>
                <Row><Wand2 size={18} color={c.primary} /><T weight="700">Change this logo</T></Row>
                <T muted size={12}>Describe what to change in concept {idx + 1}. Stitch redesigns it and keeps the old one in history.</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {IDEAS.map((s) => <Chip key={s} label={s} active={instruction === s} onPress={() => setInstruction(s)} />)}
                </View>
                <Field value={instruction} onChangeText={setInstruction} placeholder="e.g. make the D rounder and use orange and navy" multiline maxLength={400} style={{ minHeight: 72, textAlignVertical: 'top' }} />
                {!stitch?.connected && <ErrorBox error={Object.assign(new Error('Connect your Stitch key to change logos.'), { action: 'open_integrations' }) as any} />}
                <ErrorBox error={active ? err : null} />
                <Button title={running ? 'Changing…' : `Change logo · ${EDIT_COST} cr`} icon={<Wand2 color="#fff" size={18} />} loading={busy}
                  disabled={running || !stitch?.connected || instruction.trim().length < 3 || (typeof credits === 'number' && credits < EDIT_COST)} onPress={change} />
                {typeof credits === 'number' && credits < EDIT_COST && <T muted size={12}>Not enough credits.</T>}
              </Card>
              {job && <JobCard job={job} onDismiss={() => setJobId(null)} />}

              {active.logo && (
                <View key={active.id}>
                  <Card style={{ gap: 10 }}>
                    <Label>Palette</Label>
                    <Row style={{ flexWrap: 'wrap' }}>{active.logo.palette.map((col, i) => <Animated.View key={col + i} entering={popIn.delay(i * 50)} style={{ alignItems: 'center', gap: 2 }}><View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: col, borderWidth: 1, borderColor: c.border }} /><T size={10} muted>{col}</T></Animated.View>)}</Row>
                    <Label>Typography</Label>
                    <T size={14}><T weight="700" size={14}>{active.logo.typography.heading}</T> + {active.logo.typography.body}</T>
                    <T muted size={12}>{active.logo.typography.why}</T>
                    <Button title="Download brand kit" icon={<Download color="#fff" size={18} />} onPress={() => saveDownload('GET', `/versions/${active.id}/brand-kit`, undefined, `${brand}-brand-kit.zip`, 'application/zip').catch((e) => showAlert('Error', e.message))} />
                  </Card>
                </View>
              )}

              {history.length > 0 && (
                <Card style={{ gap: 10 }}>
                  <PressScale onPress={() => setShowHistory((s) => !s)} accessibilityLabel="Previous versions">
                    <Row><History size={18} color={c.text} /><T weight="700" style={{ flex: 1 }}>Previous versions ({history.length})</T><T muted size={12}>{showHistory ? 'Hide' : 'Show'}</T></Row>
                  </PressScale>
                  {showHistory && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                      {history.map((h) => (
                        <View key={h.id} style={{ alignItems: 'center', gap: 6 }}>
                          <Thumb v={h} active={false} label="Older version" onPress={() => restore(h)} />
                          <PressScale onPress={() => restore(h)}><Row gap={4}><Check size={12} color={c.primary} /><T size={11} style={{ color: c.primary }}>Use</T></Row></PressScale>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </Card>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
