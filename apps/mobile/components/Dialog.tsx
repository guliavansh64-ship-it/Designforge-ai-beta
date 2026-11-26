/**
 * Animated, themed replacement for Alert.alert + lightweight toasts.
 *
 *  showAlert(title, message?, buttons?)  — same signature as Alert.alert, so call sites stay simple.
 *  toast(message, tone?)                 — non-blocking confirmation pill (auto-hides).
 *
 * Motion: backdrop fades, the card POPS in (spring scale from 0.86) with its icon popping a beat later,
 * and shrinks out on close. Toasts spring down from the top. Everything respects "Remove animations".
 * <DialogHost /> is mounted once in app/_layout.tsx, above the navigator.
 */
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react-native';
import Animated, { Easing, FadeIn, FadeInUp, FadeOut, FadeOutUp, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { radius, useColors } from '../lib/theme';
import { T } from './ui';
import { PressScale } from './motion';

export type DialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void | Promise<void> };
export type Tone = 'success' | 'error' | 'warning' | 'info';
type DialogReq = { id: number; title: string; message?: string; buttons: DialogButton[]; tone: Tone };
type ToastReq = { id: number; message: string; tone: Tone };

let seq = 0;
let dialogSink: ((d: DialogReq) => void) | null = null;
let toastSink: ((t: ToastReq) => void) | null = null;
const pendingDialogs: DialogReq[] = [];

function guessTone(title: string, buttons?: DialogButton[]): Tone {
  if (buttons?.some((b) => b.style === 'destructive')) return 'warning';
  if (/(error|failed|not completed|couldn|invalid|denied)/i.test(title)) return 'error';
  if (/(connected|verified|success|ready|created|saved|done|restored|sent)/i.test(title)) return 'success';
  if (/\?$/.test(title)) return 'warning';
  return 'info';
}

export function showAlert(title: string, message?: string, buttons?: DialogButton[], tone?: Tone) {
  const d: DialogReq = { id: ++seq, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }], tone: tone ?? guessTone(title, buttons) };
  if (dialogSink) dialogSink(d); else pendingDialogs.push(d);
}

export function toast(message: string, tone: Tone = 'success') {
  toastSink?.({ id: ++seq, message, tone });
}

function toneIcon(tone: Tone, c: ReturnType<typeof useColors>, size = 26) {
  const map = { success: [CheckCircle2, c.green], error: [XCircle, c.red], warning: [AlertTriangle, c.amber], info: [Info, c.primary] } as const;
  const [I, col] = map[tone];
  return { node: <I size={size} color={col} />, color: col };
}

export function DialogHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<DialogReq[]>([]);
  const [toasts, setToasts] = useState<ToastReq[]>([]);
  const current = queue[0];

  useEffect(() => {
    dialogSink = (d) => setQueue((q) => [...q, d]);
    toastSink = (t) => {
      setToasts((x) => [...x.slice(-2), t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 2400);
    };
    if (pendingDialogs.length) setQueue((q) => [...q, ...pendingDialogs.splice(0)]);
    return () => { dialogSink = null; toastSink = null; };
  }, []);

  useEffect(() => {
    if (!current) return;
    const kind = current.tone === 'success' ? Haptics.NotificationFeedbackType.Success : current.tone === 'error' ? Haptics.NotificationFeedbackType.Error : current.tone === 'warning' ? Haptics.NotificationFeedbackType.Warning : null;
    if (kind) Haptics.notificationAsync(kind).catch(() => undefined);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const cancel = current.buttons.find((b) => b.style === 'cancel');
      close(cancel ?? (current.buttons.length === 1 ? current.buttons[0] : undefined));
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const close = (b?: DialogButton) => {
    setQueue((q) => q.slice(1));
    if (b?.onPress) setTimeout(() => { Promise.resolve(b.onPress!()).catch(() => undefined); }, 0);
  };

  const icon = current ? toneIcon(current.tone, c) : null;
  const stacked = (current?.buttons.length ?? 0) > 2;

  return (
    <>
      {current && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
            <Pressable style={{ flex: 1 }} accessibilityLabel="Close dialog"
              onPress={() => { const cancel = current.buttons.find((b) => b.style === 'cancel'); if (cancel || current.buttons.length === 1) close(cancel ?? current.buttons[0]); }} />
          </Animated.View>
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 28 }]} pointerEvents="box-none">
            <Animated.View key={current.id}
              entering={ZoomIn.springify().damping(15).stiffness(260).withInitialValues({ transform: [{ scale: 0.86 }] })}
              exiting={ZoomOut.duration(130).easing(Easing.in(Easing.quad))}
              accessibilityViewIsModal accessibilityRole="alert"
              style={{ width: '100%', maxWidth: 380, backgroundColor: c.card, borderRadius: radius.lg + 4, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 20, gap: 12, elevation: 24, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 24 }}>
              <Animated.View entering={ZoomIn.delay(90).springify().damping(10).stiffness(240)}
                style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: icon!.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                {icon!.node}
              </Animated.View>
              <T size={18} weight="700">{current.title}</T>
              {!!current.message && <T muted size={14}>{current.message}</T>}
              <View style={{ flexDirection: stacked ? 'column' : 'row-reverse', gap: 8, marginTop: 6 }}>
                {[...current.buttons].sort((a, b) => (a.style === 'cancel' ? 1 : 0) - (b.style === 'cancel' ? 1 : 0)).map((b, i) => {
                  const primary = i === 0 && b.style !== 'cancel';
                  const bg = b.style === 'destructive' ? c.red : primary ? c.primary : c.card2;
                  return (
                    <PressScale key={b.text + i} onPress={() => close(b)} accessibilityRole="button" scaleTo={0.95}
                      style={{ flex: stacked ? undefined : 1, minHeight: 44, borderRadius: radius.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: primary || b.style === 'destructive' ? 0 : 1, borderColor: c.border }}>
                      <T weight="600" style={{ color: primary || b.style === 'destructive' ? '#fff' : c.text }}>{b.text}</T>
                    </PressScale>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </View>
      )}
      <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, gap: 8, alignItems: 'center' }}>
        {toasts.map((t) => {
          const ic = toneIcon(t.tone, c, 18);
          return (
            <Animated.View key={t.id} entering={FadeInUp.springify().damping(16).stiffness(220)} exiting={FadeOutUp.duration(180)}
              accessibilityLiveRegion="polite"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: ic.color + '88', elevation: 12, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, maxWidth: '100%' }}>
              <Animated.View entering={ZoomIn.delay(80).springify().damping(10)}>{ic.node}</Animated.View>
              <T size={14} weight="500" style={{ flexShrink: 1 }}>{t.message}</T>
            </Animated.View>
          );
        })}
      </View>
    </>
  );
}
