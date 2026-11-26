/**
 * DesignForge motion system (Reanimated 3, UI-thread animations).
 *
 * Rules:
 *  - Springs for interaction, short timings for opacity. Nothing blocks input.
 *  - Entering/layout animations use ReduceMotion.System (Reanimated default), so they are skipped
 *    when Android "Remove animations" is on. Decorative loops (orbs, shimmer, pulse) check
 *    useReducedMotion() and stay static.
 *  - Stagger is capped so long lists don't feel slow.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn,
  cancelAnimation, interpolate, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { useColors } from '../lib/theme';

export { Animated };
export const SPRING = { damping: 18, stiffness: 220, mass: 0.9 } as const;
const MAX_STAGGER = 8;

/** Layout transition for lists: items glide into place when others are added/removed. */
export const listLayout = LinearTransition.springify().damping(20).stiffness(180);

/**
 * Fade + rise on mount, staggered by index.
 * PERF: timing-based (not spring) and NO layout transition — layout animations on every card forced
 * Reanimated to re-measure the whole tree on each update, which caused visible jank on Android.
 */
export function Appear({ children, index = 0, style, delay = 0, from = 12 }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle>; delay?: number; from?: number }) {
  const d = delay + Math.min(index, MAX_STAGGER) * 45;
  return (
    <Animated.View style={style} entering={FadeInDown.delay(d).duration(260).easing(Easing.out(Easing.cubic)).withInitialValues({ opacity: 0, transform: [{ translateY: from }] })}>
      {children}
    </Animated.View>
  );
}

/** Cross-fade when `id` changes (tabs, segmented content). */
export function Swap({ id, children, style }: { id: string | number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Animated.View key={id} style={style} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)}>{children}</Animated.View>;
}

const APressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that springs down on touch (the core "tactile" feel). */
export function PressScale({ children, style, scaleTo = 0.96, disabled, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable {...rest} disabled={disabled}
      onPressIn={(e) => { s.value = withSpring(scaleTo, SPRING); rest.onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withSpring(1, SPRING); rest.onPressOut?.(e); }}
      style={[style, a]}>
      {children}
    </APressable>
  );
}

/**
 * Animated progress bar. PERF: the fill is a full-width bar slid in with translateX (GPU transform)
 * instead of animating `width`, which forced a layout pass every frame.
 */
export function AnimatedProgress({ value, active = true, color }: { value: number; active?: boolean; color?: string }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  const sheen = useSharedValue(0);
  const tw = useSharedValue(0);
  useEffect(() => { v.value = withTiming(Math.max(3, Math.min(100, value)) / 100, { duration: reduce ? 0 : 450, easing: Easing.out(Easing.cubic) }); }, [value, v, reduce]);
  useEffect(() => {
    if (active && !reduce) sheen.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, false);
    else { cancelAnimation(sheen); sheen.value = 0; }
    return () => cancelAnimation(sheen);
  }, [active, reduce, sheen]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - v.value) * tw.value }] }));
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(sheen.value, [0, 1], [-80, tw.value]) }] }));
  return (
    <View onLayout={(e) => { tw.value = e.nativeEvent.layout.width; }} style={{ height: 6, backgroundColor: c.card2, borderRadius: 3, overflow: 'hidden' }}
      accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(value), min: 0, max: 100 }}>
      <Animated.View style={[{ ...StyleSheetAbsolute, backgroundColor: color ?? c.primary, borderRadius: 3, overflow: 'hidden' }, bar]}>
        {active && !reduce && (
          <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: 80 }, shine]}>
            <LinearGradient colors={['transparent', 'rgba(255,255,255,0.4)', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

/** Shimmering placeholder block for loading states. */
export function Skeleton({ height = 16, width = '100%', radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  const w = useSharedValue(300);
  useEffect(() => {
    if (!reduce) t.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => cancelAnimation(t);
  }, [reduce, t]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(t.value, [0, 1], [-w.value, w.value]) }] }));
  return (
    <View onLayout={(e) => { w.value = e.nativeEvent.layout.width; }} style={[{ height, width, borderRadius: radius, backgroundColor: c.card2, overflow: 'hidden' }, style]} accessibilityLabel="Loading">
      <Animated.View style={[{ ...StyleSheetAbsolute }, a]}>
        <LinearGradient colors={['transparent', c.border + 'cc', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
      </Animated.View>
    </View>
  );
}
const StyleSheetAbsolute = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

/** A few skeleton rows shaped like list cards. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ backgroundColor: c.card, borderRadius: 20, padding: 16, gap: 10, borderWidth: 0.5, borderColor: c.border }}>
          <Skeleton height={16} width="60%" /><Skeleton height={12} width="35%" />
        </View>
      ))}
    </View>
  );
}

/** Soft pulsing ring — "something is running". */
export function Pulse({ color, size = 12 }: { color: string; size?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!reduce) p.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [reduce, p]);
  const ring = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.55, 0]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 2.6]) }] }));
  return (
    <View style={{ width: size * 2.6, height: size * 2.6, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color }, ring]} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Three bouncing dots ("assistant is thinking"). */
export function TypingDots({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5, paddingVertical: 4 }} accessibilityLabel="Working">
      {[0, 1, 2].map((i) => <Dot key={i} i={i} color={color} />)}
    </View>
  );
}
function Dot({ i, color }: { i: number; color: string }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!reduce) y.value = withDelay(i * 140, withRepeat(withSequence(withTiming(-5, { duration: 260 }), withTiming(0, { duration: 260 }), withTiming(0, { duration: 300 })), -1, false));
    return () => cancelAnimation(y);
  }, [reduce, y, i]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: interpolate(y.value, [-5, 0], [1, 0.45]) }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, a]} />;
}

/** Number that counts to its new value (credits, scores). JS-driven, so kept short. */
export function CountUp({ value, style, duration = 450, format = (n: number) => n.toLocaleString('en-IN') }: { value: number; style?: StyleProp<TextStyle>; duration?: number; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce || from.current === value) { from.current = value; setShown(value); return; }
    const start = from.current; const t0 = Date.now(); let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / duration); const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);
  return <Text style={style} accessibilityLabel={format(value)}>{format(shown)}</Text>;
}

/** Gentle float loop (empty-state illustrations, hero icons). */
export function Float({ children, amplitude = 6, duration = 2200 }: { children: ReactNode; amplitude?: number; duration?: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!reduce) y.value = withRepeat(withSequence(withTiming(-amplitude, { duration, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })), -1, false);
    return () => cancelAnimation(y);
  }, [reduce, y, amplitude, duration]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

/** Slowly drifting gradient blobs for hero backgrounds (login, splash). */
export function Orbs() {
  const c = useColors();
  return (
    <View pointerEvents="none" style={StyleSheetAbsolute}>
      <Orb color={c.primary} size={320} x={-90} y={-60} dx={40} dy={30} duration={7000} />
      <Orb color={c.ember} size={260} x={180} y={260} dx={-30} dy={40} duration={9000} />
      <Orb color="#38bdf8" size={220} x={-40} y={520} dx={50} dy={-30} duration={8000} />
    </View>
  );
}
function Orb({ color, size, x, y, dx, dy, duration }: { color: string; size: number; x: number; y: number; dx: number; dy: number; duration: number }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduce) t.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [reduce, t, duration]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x + dx * t.value }, { translateY: y + dy * t.value }] }));
  // PERF: alpha lives in the gradient colours (a view-level opacity forces offscreen compositing every
  // frame on Android) and the layer is cached as a hardware texture, so drifting is a cheap GPU move.
  return (
    <Animated.View renderToHardwareTextureAndroid style={[{ position: 'absolute', width: size, height: size }, a]}>
      <LinearGradient colors={[color + '3a', color + '00']} style={{ flex: 1, borderRadius: size / 2 }} start={{ x: 0.5, y: 0.5 }} end={{ x: 1, y: 1 }} />
    </Animated.View>
  );
}

/** Animated chip/segment background (colour + scale) driven by `active`. */
export function useActiveStyle(active: boolean | undefined, colors: { on: string; off: string; borderOn: string; borderOff: string }) {
  const v = useSharedValue(active ? 1 : 0);
  useEffect(() => { v.value = withTiming(active ? 1 : 0, { duration: 180 }); }, [active, v]);
  return useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], [colors.off, colors.on]),
    borderColor: interpolateColor(v.value, [0, 1], [colors.borderOff, colors.borderOn]),
  }));
}

/** Horizontal shake (validation / error feedback). Call the returned trigger. */
export function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => { x.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 60 }), withTiming(-5, { duration: 60 }), withTiming(5, { duration: 60 }), withTiming(0, { duration: 50 })); };
  return { style, shake };
}

/** Pop-in for success icons / badges. */
export const popIn = ZoomIn.springify().damping(12).stiffness(220);
