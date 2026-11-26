import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronLeft, ChevronRight, Code2, Download, FileCode2, FileArchive, Image as ImageIcon, Monitor, Pencil, Smartphone, Tablet, X } from 'lucide-react-native';
import { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useColors } from '../../lib/theme';
import type { Project, Version } from '../../lib/types';
import { HtmlPreview } from '../../components/HtmlPreview';
import { showAlert, toast } from '../../components/Dialog';
import { Button, Chip, ErrorBox, Row, T } from '../../components/ui';
import { Animated, PressScale, Skeleton } from '../../components/motion';

type Device = 'MOBILE' | 'TABLET' | 'DESKTOP';
const DEVICES: { id: Device; label: string; Icon: typeof Smartphone; size: string }[] = [
  { id: 'MOBILE', label: 'Mobile', Icon: Smartphone, size: '390 × 844' },
  { id: 'TABLET', label: 'Tablet', Icon: Tablet, size: '834 × 1194' },
  { id: 'DESKTOP', label: 'Desktop', Icon: Monitor, size: '1280 × 800' },
];

/** Labelled Mobile / Tablet / Desktop switch with a sliding highlight. */
function DeviceBar({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const idx = DEVICES.findIndex((d) => d.id === device);
  useEffect(() => { x.value = withSpring(idx * (w / 3), { damping: 18, stiffness: 220 }); }, [idx, w, x]);
  const hl = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border }}>
      {w > 0 && <Animated.View style={[{ position: 'absolute', width: w / 3, top: 0, bottom: 0, borderRadius: 13, backgroundColor: c.primary }, hl]} />}
      {DEVICES.map(({ id, label, Icon }) => (
        <PressScale key={id} onPress={() => { Haptics.selectionAsync().catch(() => undefined); onChange(id); }} scaleTo={0.92}
          accessibilityRole="button" accessibilityLabel={`${label} view`} accessibilityState={{ selected: device === id }}
          style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}>
          <Icon size={16} color={device === id ? '#fff' : c.muted} />
          <T size={13} weight="600" style={{ color: device === id ? '#fff' : c.muted }}>{label}</T>
        </PressScale>
      ))}
    </View>
  );
}

/**
 * Full-screen preview of a generated app/website: device switch on top, all screens of the app as
 * tabs, and downloads (screenshot, single HTML page, whole-app ZIP as HTML or React).
 */
export default function PreviewScreen() {
  const { id, page: initialPage } = useLocalSearchParams<{ id: string; page?: string }>();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { me, refresh } = useAuth();
  const [project, setProject] = useState<(Project & { access: string }) | null>(null);
  const [pageId, setPageId] = useState<string | null>(initialPage ?? null);
  const [device, setDevice] = useState<Device>('MOBILE');
  const [versions, setVersions] = useState<Record<string, Version>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { project: p } = await api.get<{ project: Project & { access: string } }>(`/projects/${id}`);
      setProject(p);
      setPageId((cur) => (cur && p.pages.some((x) => x.id === cur && x.currentVersionId) ? cur : p.pages.find((x) => x.currentVersionId)?.id ?? null));
      if (p.deviceType === 'DESKTOP' || p.deviceType === 'TABLET') setDevice(p.deviceType);
    } catch (e) { setErr(e as ApiError); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const pages = useMemo(() => (project?.pages ?? []).filter((p) => p.currentVersionId), [project]);
  const page = pages.find((p) => p.id === pageId);
  const version = page?.currentVersionId ? versions[page.currentVersionId] : undefined;
  const idx = pages.findIndex((p) => p.id === pageId);

  // Load the current page and prefetch its neighbours so switching screens is instant.
  useEffect(() => {
    const want = [idx, idx + 1, idx - 1].map((i) => pages[i]?.currentVersionId).filter((v): v is string => !!v && !versions[v]);
    want.forEach((vid) => api.get<{ version: Version }>(`/versions/${vid}`).then((r) => setVersions((m) => ({ ...m, [vid]: r.version }))).catch((e) => setErr(e)));
  }, [idx, pages, versions]);

  const go = (d: number) => { const n = pages[idx + d]; if (n) { Haptics.selectionAsync().catch(() => undefined); setPageId(n.id); } };

  const download = async (kind: 'png' | 'html' | 'zip-html' | 'zip-react') => {
    if (!project) return;
    setBusy(kind); setErr(null);
    const safe = project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'design';
    const pg = (page?.name ?? 'screen').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    try {
      if (kind === 'png') {
        if (!version) return;
        await api.downloadAndShare('GET', `/versions/${version.id}/download?format=png`, null, `${safe}-${pg}.png`, 'image/png');
      } else if (kind === 'html') {
        if (!version) return;
        await api.downloadAndShare('GET', `/versions/${version.id}/download?format=html`, null, `${safe}-${pg}.html`, 'text/html');
      } else {
        const format = kind === 'zip-react' ? 'react' : 'html';
        await api.downloadAndShare('POST', `/projects/${project.id}/export`, { format, idempotencyKey: newKey() }, `${safe}-${format}.zip`);
        refresh();
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast('Ready — choose where to save it', 'success');
      setSheet(false);
    } catch (e) {
      const ae = e as ApiError;
      setSheet(false);
      showAlert('Download failed', ae.message);
    } finally { setBusy(null); }
  };

  // Device frame sizing: the WebView gets the real device viewport width; the frame only sets the look.
  const avail = winW - 24;
  const frame = device === 'MOBILE'
    ? { width: Math.min(avail, 400), radius: 34, bezel: 8 }
    : device === 'TABLET' ? { width: Math.min(avail, 640), radius: 24, bezel: 10 } : { width: avail, radius: 12, bezel: 0 };
  const reactOk = !!me?.plan.features.includes('react_export');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade_from_bottom' }} />

      {/* Top bar */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 10 }}>
        <Row>
          <PressScale onPress={() => router.back()} accessibilityLabel="Back" style={{ padding: 8, borderRadius: 12, backgroundColor: c.card }}><ArrowLeft size={20} color={c.text} /></PressScale>
          <View style={{ flex: 1 }}>
            <T weight="700" numberOfLines={1}>{project?.name ?? 'Preview'}</T>
            <T muted size={12} numberOfLines={1}>{page ? `${page.name} · ${idx + 1}/${pages.length}` : ' '} · {DEVICES.find((d) => d.id === device)!.size}</T>
          </View>
          <PressScale onPress={() => router.replace(`/project/${id}`)} accessibilityLabel="Edit in project" style={{ padding: 8, borderRadius: 12, backgroundColor: c.card }}><Pencil size={18} color={c.text} /></PressScale>
          <PressScale onPress={() => setSheet(true)} accessibilityLabel="Download" style={{ padding: 8, borderRadius: 12, backgroundColor: c.primary }}><Download size={18} color="#fff" /></PressScale>
        </Row>
        <DeviceBar device={device} onChange={setDevice} />
        {pages.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {pages.map((p) => <Chip key={p.id} label={p.name} active={p.id === pageId} onPress={() => setPageId(p.id)} />)}
          </ScrollView>
        )}
        <ErrorBox error={err} />
      </View>

      {/* Device viewport */}
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) }}>
        {!project ? <View style={{ width: '100%', gap: 12 }}><Skeleton height={420} radius={24} /></View>
          : !pages.length ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}><T weight="600">Nothing generated yet</T><Button small title="Open project" onPress={() => router.replace(`/project/${id}`)} /></View>
          : (
            <Animated.View key={device} entering={FadeIn.duration(220)} style={{ flex: 1, width: frame.width, padding: frame.bezel, borderRadius: frame.radius, backgroundColor: device === 'DESKTOP' ? 'transparent' : '#0b0b0f', borderWidth: device === 'DESKTOP' ? 0 : 1, borderColor: c.border }}>
              {device === 'DESKTOP' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderBottomWidth: 0, borderColor: c.border }}>
                  {['#ff5f57', '#febc2e', '#28c840'].map((col) => <View key={col} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: col }} />)}
                  <View style={{ flex: 1, marginLeft: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, backgroundColor: c.bg }}><T muted size={11} numberOfLines={1}>{(project.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '')}.app/{(page?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}</T></View>
                </View>
              )}
              {version
                ? <Animated.View key={version.id} entering={FadeInDown.springify().damping(18)} style={{ flex: 1 }}><HtmlPreview html={version.html} device={device} height="fill" radius={device === 'DESKTOP' ? 0 : frame.radius - frame.bezel} bordered={device === 'DESKTOP'} /></Animated.View>
                : <View style={{ flex: 1, padding: 16, gap: 12, backgroundColor: c.card, borderRadius: frame.radius - frame.bezel }}><Skeleton height={28} width="55%" /><Skeleton height={160} /><Skeleton height={14} width="80%" /><Skeleton height={14} width="60%" /></View>}
            </Animated.View>
          )}
        {pages.length > 1 && (
          <Row style={{ marginTop: 10, justifyContent: 'space-between', width: '100%' }}>
            <Button small variant="secondary" title="Previous" icon={<ChevronLeft size={16} color={c.text} />} disabled={idx <= 0} onPress={() => go(-1)} style={{ flex: 1 }} />
            <Button small variant="secondary" title="Next" icon={<ChevronRight size={16} color={c.text} />} disabled={idx >= pages.length - 1} onPress={() => go(1)} style={{ flex: 1 }} />
          </Row>
        )}
      </View>

      {/* Download sheet */}
      <Modal visible={sheet} transparent animationType="fade" onRequestClose={() => setSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }} onPress={() => setSheet(false)}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 16 + insets.bottom, gap: 10 }}>
            <Row style={{ justifyContent: 'space-between' }}><T weight="700" size={18}>Download</T><Pressable onPress={() => setSheet(false)} accessibilityLabel="Close"><X color={c.text} /></Pressable></Row>
            <T muted size={12}>Files open in Android's share sheet — save to Files/Downloads, Drive, WhatsApp, email…</T>
            <Button variant="secondary" title={`Screenshot of "${page?.name ?? 'screen'}" (PNG) · free`} icon={<ImageIcon size={18} color={c.text} />} loading={busy === 'png'} disabled={!version?.imageUrl || !!busy} onPress={() => download('png')} />
            {version && !version.imageUrl && <T muted size={11}>No screenshot was returned by Stitch for this screen.</T>}
            <Button variant="secondary" title={`This page as one .html file · free`} icon={<FileCode2 size={18} color={c.text} />} loading={busy === 'html'} disabled={!version || !!busy} onPress={() => download('html')} />
            <Button title={`Whole ${pages.length > 1 ? `app (${pages.length} screens)` : 'project'} · HTML/CSS ZIP · 1 cr`} icon={<FileArchive size={18} color="#fff" />} loading={busy === 'zip-html'} disabled={!pages.length || !!busy} onPress={() => download('zip-html')} />
            <Button variant="secondary" title={`React + TypeScript project ZIP · 2 cr${reactOk ? '' : ' 🔒'}`} icon={<Code2 size={18} color={c.text} />} loading={busy === 'zip-react'} disabled={!pages.length || !reactOk || !!busy} onPress={() => download('zip-react')} />
            {!reactOk && <T muted size={11}>React export is included in Pro and above.</T>}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
