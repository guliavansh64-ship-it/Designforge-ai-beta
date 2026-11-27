import { memo, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing, cancelAnimation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { Folder, LayoutGrid, MessageSquare, Plus, Settings } from 'lucide-react-native';
import { BAR, barPath, fabCenterY } from './tabBarShape';
import { useColors, type Colors } from '../lib/theme';

/**
 * Premium bottom navigation in the app's own theme: a curved card-coloured bar with the brand gradient
 * (purple → violet → ember, same as the credits card and primary buttons) on its border, and a raised,
 * glowing brand-gradient PLUS button in the centre that opens Studio. Follows light / dark mode.
 * It is the real navigator tab bar (expo-router <Tabs tabBar>), so routing, state, back behaviour and
 * screen reuse are all handled by React Navigation — no duplicate screens are ever created.
 */

const VIOLET = '#a855f7'; // middle stop of the brand gradient (see components/ui.tsx primary button)
const alpha = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
const ICONS: Record<string, typeof Settings> = { index: LayoutGrid, projects: Folder, assistant: MessageSquare, settings: Settings };
const CENTER = 'studio';

/** Height the screens must leave free at the bottom (bar body + gap to the system navigation bar). */
export const tabBarSpace = (bottomInset: number) => BAR.height + bottomInset + 8;

const TabItem = memo(function TabItem({ label, Icon, focused, onPress, onLongPress, compact, c }: {
  label: string; Icon: typeof Settings; focused: boolean; onPress: () => void; onLongPress: () => void; compact: boolean; c: Colors;
}) {
  const reduce = useReducedMotion();
  const f = useSharedValue(focused ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    f.value = reduce ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: 240 });
    if (focused && !reduce) pop.value = withSequence(withSpring(1.22, { damping: 7, stiffness: 320 }), withSpring(1, { damping: 12 }));
  }, [focused, reduce, f, pop]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }, { translateY: interpolate(f.value, [0, 1], [0, -2]) }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: f.value * 0.9, transform: [{ scale: interpolate(f.value, [0, 1], [0.6, 1]) }] }));
  const color = focused ? c.primary : c.muted;
  return (
    <Pressable
      onPress={onPress} onLongPress={onLongPress} style={s.item}
      android_ripple={{ color: alpha(c.primary, 0.2), borderless: true, radius: 34 }}
      accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} hitSlop={4}
    >
      <View style={s.iconWrap}>
        <Animated.View pointerEvents="none" style={[s.iconGlow, { backgroundColor: alpha(c.primary, 0.16), borderColor: alpha(c.primary, 0.3) }, glowStyle]} />
        <Animated.View style={iconStyle}><Icon size={22} color={color} strokeWidth={focused ? 2.4 : 2} /></Animated.View>
      </View>
      <Text numberOfLines={1} style={[s.label, compact && s.labelCompact, { color, fontWeight: focused ? '700' : '500' }]}>{label}</Text>
    </Pressable>
  );
});

function StudioButton({ focused, onPress, onLongPress, left, c }: { focused: boolean; onPress: () => void; onLongPress: () => void; left: number; c: Colors }) {
  const reduce = useReducedMotion();
  const breath = useSharedValue(1);
  const spin = useSharedValue(0);
  const halo = useSharedValue(0);
  const press = useSharedValue(1);
  const sel = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    if (reduce) return;
    breath.value = withRepeat(withSequence(withTiming(1.045, { duration: 1700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) })), -1);
    spin.value = withRepeat(withTiming(360, { duration: 5200, easing: Easing.linear }), -1);
    halo.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1);
    return () => { cancelAnimation(breath); cancelAnimation(spin); cancelAnimation(halo); };
  }, [reduce, breath, spin, halo]);
  useEffect(() => { sel.value = withTiming(focused ? 1 : 0, { duration: 300 }); }, [focused, sel]);

  const fabStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.value * press.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }], opacity: 0.55 + sel.value * 0.45 }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - halo.value) * (0.28 + sel.value * 0.3),
    transform: [{ scale: 1 + halo.value * (0.45 + sel.value * 0.15) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 + sel.value * 0.4, transform: [{ scale: 1.08 + sel.value * 0.1 }] }));

  const r = BAR.ring / 2 - 4;
  const circ = 2 * Math.PI * r;
  return (
    <View pointerEvents="box-none" style={[s.ringBox, { left: left - BAR.ring / 2, top: fabCenterY() - BAR.ring / 2 }]}>
      <Animated.View pointerEvents="none" style={[s.halo, { backgroundColor: c.primary }, haloStyle]} />
      <Animated.View pointerEvents="none" style={[s.halo, { backgroundColor: alpha(VIOLET, 0.5) }, glowStyle]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ringStyle]}>
        <Svg width={BAR.ring} height={BAR.ring}>
          <Defs>
            <SvgGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="0.5" stopColor={VIOLET} stopOpacity="0.9" />
              <Stop offset="1" stopColor={c.ember} stopOpacity="0.25" />
            </SvgGradient>
          </Defs>
          <Circle cx={BAR.ring / 2} cy={BAR.ring / 2} r={r} stroke={c.primary} strokeOpacity={0.22} strokeWidth={1.5} fill="none" />
          <Circle cx={BAR.ring / 2} cy={BAR.ring / 2} r={r} stroke="url(#ring)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={`${circ * 0.26} ${circ * 0.74}`} />
        </Svg>
      </Animated.View>
      <Pressable
        onPress={onPress} onLongPress={onLongPress}
        onPressIn={() => { press.value = withSpring(0.9, { damping: 14, stiffness: 400 }); }}
        onPressOut={() => { press.value = withSpring(1, { damping: 10, stiffness: 260 }); }}
        android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: true, radius: BAR.fab / 2 }}
        accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel="Studio — create a new design"
        style={s.fabHit} hitSlop={8}
      >
        <Animated.View style={[s.fab, fabStyle]}>
          <LinearGradient colors={[c.primary, VIOLET, c.ember]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.55 }} style={s.fabShine} />
          <View style={s.plus}><Plus size={32} color="#FFFFFF" strokeWidth={3} /></View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export function CurvedTabBar({ state, descriptors, navigation, insets, hidden }: BottomTabBarProps & { hidden?: boolean }) {
  const { width: screenW } = useWindowDimensions();
  const c = useColors();
  const isLight = c.bg !== '#0a0a0f';
  const [measured, setMeasured] = useState(0);
  const barW = measured || Math.min(screenW - BAR.margin * 2, BAR.maxWidth);
  const compact = barW < 380;
  const bottom = insets.bottom + 8;
  const d = barPath(barW);

  if (hidden) return null;

  const go = (routeIndex: number) => {
    const route = state.routes[routeIndex];
    const focused = state.index === routeIndex;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) {
      if (Platform.OS !== 'web') Haptics.impactAsync(route.name === CENTER ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      navigation.navigate(route.name, route.params);
    }
  };
  const longPress = (routeIndex: number) => navigation.emit({ type: 'tabLongPress', target: state.routes[routeIndex].key });

  const centerIndex = state.routes.findIndex((r) => r.name === CENTER);
  const sides = state.routes.map((r, i) => ({ r, i })).filter(({ r }) => r.name !== CENTER);
  const left = sides.slice(0, Math.ceil(sides.length / 2));
  const right = sides.slice(Math.ceil(sides.length / 2));
  const labelOf = (i: number) => {
    const o = descriptors[state.routes[i].key].options;
    return typeof o.tabBarLabel === 'string' ? o.tabBarLabel : o.title ?? state.routes[i].name;
  };
  const renderSide = ({ r, i }: { r: (typeof state.routes)[number]; i: number }) => (
    <TabItem key={r.key} c={c} label={labelOf(i)} Icon={ICONS[r.name] ?? LayoutGrid} focused={state.index === i} compact={compact} onPress={() => go(i)} onLongPress={() => longPress(i)} />
  );
  const studioFocused = state.index === centerIndex;

  return (
    <View pointerEvents="box-none" style={[s.wrap, { paddingBottom: bottom }]}>
      <View
        pointerEvents="box-none"
        style={{ width: Math.min(screenW - BAR.margin * 2, BAR.maxWidth), height: BAR.top + BAR.height, alignSelf: 'center' }}
        onLayout={(e) => setMeasured(Math.round(e.nativeEvent.layout.width))}
      >
        <Svg pointerEvents="none" width={barW} height={BAR.top + BAR.height} style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={isLight ? c.card : c.card2} stopOpacity="0.97" />
              <Stop offset="1" stopColor={c.card} stopOpacity="0.99" />
            </SvgGradient>
            <SvgGradient id="edge" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={c.primary} />
              <Stop offset="0.5" stopColor={VIOLET} />
              <Stop offset="1" stopColor={c.ember} />
            </SvgGradient>
            <SvgGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={isLight ? 0 : 0.05} />
              <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
            </SvgGradient>
          </Defs>
          <Path d={d} fill="url(#fill)" />
          <Path d={d} fill="url(#sheen)" />
          <Path d={d} fill="none" stroke="url(#edge)" strokeOpacity={isLight ? 0.06 : 0.08} strokeWidth={10} />
          <Path d={d} fill="none" stroke="url(#edge)" strokeOpacity={isLight ? 0.14 : 0.2} strokeWidth={4.5} />
          <Path d={d} fill="none" stroke="url(#edge)" strokeWidth={1.4} />
        </Svg>

        <View pointerEvents="box-none" style={[s.row, { height: BAR.height - BAR.pad, top: BAR.top, left: BAR.pad, right: BAR.pad }]}>
          {left.map(renderSide)}
          <Pressable onPress={() => centerIndex >= 0 && go(centerIndex)} style={[s.centerSlot, { width: BAR.notchHalf * 2 - 8 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text numberOfLines={1} style={[s.label, compact && s.labelCompact, s.studioLabel, { color: studioFocused ? c.primary : c.text, fontWeight: studioFocused ? '800' : '600' }]}>Studio</Text>
          </Pressable>
          {right.map(renderSide)}
        </View>

        {centerIndex >= 0 && <StudioButton c={c} focused={studioFocused} left={barW / 2} onPress={() => go(centerIndex)} onLongPress={() => longPress(centerIndex)} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { position: 'absolute', flexDirection: 'row', alignItems: 'stretch' },
  item: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 2 },
  iconWrap: { width: 44, height: 30, alignItems: 'center', justifyContent: 'center' },
  iconGlow: { position: 'absolute', width: 40, height: 28, borderRadius: 14, borderWidth: 1 },
  label: { fontSize: 11, letterSpacing: 0.2 },
  labelCompact: { fontSize: 10, letterSpacing: 0 },
  centerSlot: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  studioLabel: {},
  ringBox: { position: 'absolute', width: BAR.ring, height: BAR.ring, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: BAR.fab, height: BAR.fab, borderRadius: BAR.fab / 2 },
  fabHit: { width: BAR.fab, height: BAR.fab, borderRadius: BAR.fab / 2 },
  fab: {
    width: BAR.fab, height: BAR.fab, borderRadius: BAR.fab / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', elevation: 14, shadowColor: '#7c5cff', shadowOpacity: 0.7, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  fabShine: { position: 'absolute', top: 0, left: 0, right: 0, height: BAR.fab * 0.6 },
  plus: { position: 'relative', zIndex: 2, alignItems: 'center', justifyContent: 'center' },
});
