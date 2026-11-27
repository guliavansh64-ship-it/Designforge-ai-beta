import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ChevronDown, Layers, RotateCcw, X } from 'lucide-react-native';
import { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { api, ApiError } from '../../lib/api';
import { useColors } from '../../lib/theme';
import type { Project, Version } from '../../lib/types';
import { resolveTap, TAP_SCRIPT, type ProtoScreen } from '../../lib/prototype';
import { ErrorBox, T } from '../../components/ui';
import { Animated, PressScale } from '../../components/motion';
import { Logo } from '../../components/Logo';

const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";
const WIDTH: Record<string, string> = { MOBILE: 'device-width', AGNOSTIC: 'device-width', TABLET: '834', DESKTOP: '1280' };
const MAX_ALIVE = 8;

function prepare(html: string, device: string) {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=${WIDTH[device] ?? 'device-width'}, initial-scale=${WIDTH[device] === 'device-width' ? 1 : 0.3}"><script>${TAP_SCRIPT}</script>`;
  let d = (html || '<html><body></body></html>').replace(/<meta[^>]+name=["']viewport["'][^>]*>/gi, '');
  return /<head[^>]*>/i.test(d) ? d.replace(/<head([^>]*)>/i, `<head$1>${head}`) : `<head>${head}</head>${d}`;
}

type Screen = ProtoScreen & { doc: string };

/** One screen, kept mounted once visited so switching back is instant (scroll position kept). */
function ScreenView({ s, visible, onTap }: { s: Screen; visible: boolean; onTap: (label: string, href: string) => void }) {
  const source = useMemo(() => ({ html: s.doc, baseUrl: 'about:blank' }), [s.doc]);
  return (
    <View pointerEvents={visible ? 'auto' : 'none'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: visible ? 1 : 0, zIndex: visible ? 1 : 0 }}>
      <WebView
        source={source}
        originWhitelist={['about:*', 'data:*']}
        javaScriptEnabled
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        geolocationEnabled={false}
        setSupportMultipleWindows={false}
        scalesPageToFit
        onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m?.t === 'tap') onTap(String(m.label ?? ''), String(m.href ?? '')); } catch { /* ignore */ } }}
        onShouldStartLoadWithRequest={(r) => {
          if (r.url.startsWith('about:') || r.url.startsWith('data:')) return true;
          if (/^https?:/.test(r.url) && r.isTopFrame && r.navigationType === 'click') Linking.openURL(r.url);
          return false;
        }}
        style={{ backgroundColor: '#fff' }}
      />
    </View>
  );
}

export default function Play() {
  const { id, page } = useLocalSearchParams<{ id: string; page?: string }>();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [project, setProject] = useState<Project | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [alive, setAlive] = useState<string[]>([]);
  const history = useRef<string[]>([]);
  const [hint, setHint] = useState<string | null>('Tap buttons, tabs and menu items to move between screens');
  const [picker, setPicker] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { project: p } = await api.get<{ project: Project }>(`/projects/${id}`);
        setProject(p);
        const pages = p.pages.filter((x) => x.currentVersionId);
        const vs = await Promise.all(pages.map((pg) => api.get<{ version: Version }>(`/versions/${pg.currentVersionId}`).then((r) => r.version).catch(() => null)));
        const list: Screen[] = pages.map((pg, i) => ({ id: pg.id, name: pg.name, doc: prepare(vs[i]?.html ?? '', p.deviceType) })).filter((_, i) => !!vs[i]?.html);
        setScreens(list);
        const start = list.find((x) => x.id === page)?.id ?? list[0]?.id ?? null;
        setCurrent(start); if (start) setAlive([start]);
      } catch (e) { setErr(e as ApiError); }
    })();
  }, [id, page]);

  const flash = useCallback((msg: string, ms = 1800) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), ms);
  }, []);
  useEffect(() => { if (screens.length) flash('Tap buttons, tabs and menu items to move between screens', 3500); }, [screens.length, flash]);

  const go = useCallback((to: string, push = true) => {
    setCurrent((cur) => {
      if (cur === to) return cur;
      if (push && cur) history.current.push(cur);
      return to;
    });
    setAlive((a) => (a.includes(to) ? a : [...a, to].slice(-MAX_ALIVE)));
    Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const back = useCallback(() => {
    const prev = history.current.pop();
    if (prev) { go(prev, false); return true; }
    return false;
  }, [go]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (back() ? true : false));
    return () => sub.remove();
  }, [back]);

  const onTap = useCallback((label: string, href: string) => {
    if (!current) return;
    const r = resolveTap(label, href, screens, current);
    if (r.kind === 'go') go(r.id);
    else if (r.kind === 'back') { if (!back()) flash('This is the first screen'); }
    else if (label.trim() && label.length <= 40 && screens.length > 1) flash(`No screen for “${label.trim().slice(0, 30)}” yet`);
  }, [current, screens, go, back, flash]);

  const cur = screens.find((x) => x.id === current);
  const idx = screens.findIndex((x) => x.id === current);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
      {/* Player bar (above the screen, so it never covers the app's own buttons) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0b0b12' }}>
        <PressScale onPress={() => router.back()} accessibilityLabel="Close player" style={{ padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}><X size={18} color="#fff" /></PressScale>
        <View style={{ flex: 1 }} />
        {screens.length > 0 && (
          <PressScale onPress={() => setPicker(true)} accessibilityLabel="Choose screen" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Layers size={14} color="#fff" />
            <T size={12} weight="600" style={{ color: '#fff', maxWidth: 160 }} numberOfLines={1}>{cur?.name ?? ''} · {idx + 1}/{screens.length}</T>
            <ChevronDown size={14} color="#fff" />
          </PressScale>
        )}
        <PressScale onPress={() => { history.current = []; if (screens[0]) go(screens[0].id, false); flash('Restarted from the first screen'); }} accessibilityLabel="Restart" style={{ padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}><RotateCcw size={18} color="#fff" /></PressScale>
      </View>

      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {screens.filter((s) => alive.includes(s.id)).map((s) => <ScreenView key={s.id} s={s} visible={s.id === current} onTap={onTap} />)}
        {!screens.length && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: c.bg, padding: 24 }}>
            {err ? <ErrorBox error={err} /> : project && !screens.length ? <T muted>No designed screens to play yet.</T> : (<><Logo size={64} /><T muted>Loading your app…</T></>)}
          </View>
        )}
      </View>

      {hint && (
        <Animated.View key={hint} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(200)} pointerEvents="none"
          style={{ position: 'absolute', bottom: Math.max(insets.bottom, 12) + 70, alignSelf: 'center', maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: 'rgba(15,15,25,0.85)', zIndex: 10 }}>
          <T size={12} style={{ color: '#fff', textAlign: 'center' }}>{hint}</T>
        </Animated.View>
      )}

      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <Pressable onPress={() => setPicker(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(150)}>
            <Pressable onPress={() => undefined} style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 16 + insets.bottom, gap: 8, maxHeight: 460 }}>
              <T weight="700" size={16}>Jump to a screen</T>
              <ScrollView contentContainerStyle={{ gap: 6 }}>
                {screens.map((s, i) => (
                  <PressScale key={s.id} onPress={() => { setPicker(false); go(s.id); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: s.id === current ? c.primary + '26' : c.card, borderWidth: 1, borderColor: s.id === current ? c.primary : c.border }}>
                    <T muted size={12} style={{ width: 22 }}>{i + 1}</T>
                    <T weight={s.id === current ? '700' : '500'} style={{ flex: 1 }}>{s.name}</T>
                  </PressScale>
                ))}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}
