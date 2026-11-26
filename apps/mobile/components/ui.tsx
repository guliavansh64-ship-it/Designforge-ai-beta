import { forwardRef, memo, useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle, type StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { radius, useColors } from '../lib/theme';
import type { ApiError } from '../lib/api';
import { Animated, AnimatedProgress, Appear, Float, PressScale, popIn, useActiveStyle, useShake } from './motion';
import { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

type V = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, small }: { title: string; onPress?: () => void; variant?: V; loading?: boolean; disabled?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.red : variant === 'secondary' ? c.card2 : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : c.text;
  return (
    <PressScale accessibilityRole="button" accessibilityState={{ disabled: disabled || loading }} disabled={disabled || loading}
      onPress={() => { Haptics.selectionAsync().catch(() => undefined); onPress?.(); }}
      style={[{ backgroundColor: variant === 'primary' ? 'transparent' : bg, overflow: 'hidden', opacity: disabled ? 0.45 : 1, minHeight: small ? 36 : 48, paddingHorizontal: small ? 12 : 18, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: variant === 'secondary' ? 1 : 0, borderColor: c.border }, style]}>
      {/* Brand gradient (violet → ember) on primary buttons. */}
      {variant === 'primary' && <LinearGradient pointerEvents="none" colors={[c.primary, '#a855f7', c.ember]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />}
      {loading
        ? <Animated.View key="l" entering={FadeIn.duration(150)}><ActivityIndicator color={fg} /></Animated.View>
        : icon ? <Animated.View key="i" entering={FadeIn.duration(150)}>{icon}</Animated.View> : null}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>
    </PressScale>
  );
}

/** Card. `index` → staggered entrance; `onPress` → tactile press-scale. */
export function Card({ children, style, index, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; index?: number; onPress?: () => void; accessibilityLabel?: string }) {
  const c = useColors();
  const base: StyleProp<ViewStyle> = [{ backgroundColor: c.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 16 }, style];
  const body = onPress
    ? <PressScale onPress={onPress} scaleTo={0.975} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={base}>{children}</PressScale>
    : <View style={base}>{children}</View>;
  return index === undefined ? body : <Appear index={index}>{body}</Appear>;
}

export function T({ children, muted, size = 15, weight, style, numberOfLines }: { children: ReactNode; muted?: boolean; size?: number; weight?: '400' | '500' | '600' | '700' | '800'; style?: any; numberOfLines?: number }) {
  const c = useColors();
  return <Text numberOfLines={numberOfLines} style={[{ color: muted ? c.muted : c.text, fontSize: size, fontWeight: weight ?? '400', lineHeight: size * 1.4 }, style]}>{children}</Text>;
}
export const H = ({ children, style }: { children: ReactNode; style?: any }) => <T size={24} weight="700" style={style}>{children}</T>;
export const Label = ({ children }: { children: ReactNode }) => <T size={11} weight="600" muted style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{children}</T>;

export const Field = forwardRef<TextInput, TextInputProps>((props, ref) => {
  const c = useColors();
  return <TextInput ref={ref} placeholderTextColor={c.muted} {...props} style={[{ backgroundColor: c.card2, color: c.text, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]} />;
});

export const Chip = memo(function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const c = useColors();
  const anim = useActiveStyle(active, { on: c.primary + '26', off: c.primary + '00', borderOn: c.primary, borderOff: c.border });
  // Pop: a quick springy overshoot when the chip becomes selected (skipped on first render).
  const pop = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && active) pop.value = withSequence(withTiming(1.09, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 320 }));
    mounted.current = true;
  }, [active, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View style={popStyle}>
      <PressScale onPress={() => { Haptics.selectionAsync().catch(() => undefined); onPress?.(); }} scaleTo={0.93} accessibilityRole="button" accessibilityState={{ selected: active }}
        style={[{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 }, anim]}>
        <Text style={{ color: active ? c.primary : c.muted, fontSize: 13, fontWeight: '500' }}>{label}</Text>
      </PressScale>
    </Animated.View>
  );
});

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'red' | 'amber' | 'primary' }) {
  const c = useColors();
  const col = tone === 'green' ? c.green : tone === 'red' ? c.red : tone === 'amber' ? c.amber : tone === 'primary' ? c.primary : c.muted;
  return <Animated.View key={label} entering={popIn} style={{ backgroundColor: col + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: col, fontSize: 11, fontWeight: '700' }}>{label}</Text></Animated.View>;
}

export function Progress({ value, active = true }: { value: number; active?: boolean }) {
  return <AnimatedProgress value={value} active={active} />;
}

export function ErrorBox({ error }: { error: ApiError | Error | null | undefined }) {
  const c = useColors();
  const router = useRouter();
  const { style: shakeStyle, shake } = useShake();
  const msg = error?.message;
  useEffect(() => { if (msg) { shake(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined); } /* eslint-disable-next-line */ }, [msg]);
  if (!error) return null;
  const e = error as ApiError;
  const action = e.action === 'open_integrations' ? { l: 'Open Integrations', to: '/integrations' } : e.action === 'upgrade_plan' || e.action === 'open_billing' ? { l: 'View plans & credits', to: '/billing' } : null;
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} exiting={FadeOut.duration(150)} accessibilityRole="alert" style={[{ backgroundColor: c.ember + '1a', borderColor: c.ember + '55', borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 8 }, shakeStyle]}>
      <View style={{ flexDirection: 'row', gap: 8 }}><AlertTriangle size={18} color={c.ember} /><T size={14} style={{ flex: 1 }}>{e.message}</T></View>
      {action && <Button small variant="secondary" title={action.l} onPress={() => router.push(action.to as any)} />}
    </Animated.View>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <Appear style={{ alignItems: 'center', padding: 32, gap: 8 }}>
      <Float><View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.primary + '1a', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>{icon}</View></Float>
      <T weight="600" size={16}>{title}</T>{body && <T muted size={14} style={{ textAlign: 'center' }}>{body}</T>}{action}
    </Appear>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}
