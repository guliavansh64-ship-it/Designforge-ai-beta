import React, { useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Circle,
} from 'react-native-svg';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import {
  LayoutGrid,
  Folder,
  MessageSquare,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

interface TabItemConfig {
  name: string;
  label: string;
  Icon: LucideIcon;
}

const TABS_CONFIG: Record<string, TabItemConfig> = {
  index: { name: 'index', label: 'Dashboard', Icon: LayoutGrid },
  projects: { name: 'projects', label: 'Projects', Icon: Folder },
  studio: { name: 'studio', label: 'Studio', Icon: LayoutGrid },
  assistant: { name: 'assistant', label: 'Assistant', Icon: MessageSquare },
  settings: { name: 'settings', label: 'Settings', Icon: SettingsIcon },
};

function TabButton({
  label,
  Icon,
  isFocused,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  isFocused: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isFocused) {
      scale.value = withSequence(
        withSpring(1.22, { damping: 9, stiffness: 280 }),
        withSpring(1.0, { damping: 14 })
      );
    } else {
      scale.value = withTiming(1.0, { duration: 150 });
    }
  }, [isFocused, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      style={styles.tabButton}
    >
      <Animated.View style={[styles.tabIconWrap, animatedStyle]}>
        <Icon
          size={22}
          color={isFocused ? '#ffffff' : 'rgba(255, 255, 255, 0.58)'}
          strokeWidth={isFocused ? 2.4 : 1.8}
        />
      </Animated.View>
      <Text
        style={[
          styles.tabLabel,
          isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CurvedBottomNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const barWidth = Math.min(width - 20, 460);
  const barHeight = 68;
  const cx = barWidth / 2;
  const corner = 26;
  const bottomInset = Math.max(insets.bottom, 6);

  // Floating button animations
  const breatheScale = useSharedValue(1);
  const pressScale = useSharedValue(1);
  const ringRotation = useSharedValue(0);
  const glowPulse = useSharedValue(0.65);

  useEffect(() => {
    // Subtle breathing animation for center PLUS button
    breatheScale.value = withRepeat(
      withSequence(
        withTiming(1.045, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 1800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Pulsing outer glow
    glowPulse.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.55, { duration: 1400, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Continuous rotating light ring
    ringRotation.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
  }, [breatheScale, glowPulse, ringRotation]);

  const floatingAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breatheScale.value * pressScale.value }],
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: glowPulse.value,
  }));

  const ringAnimStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringRotation.value}deg` }],
  }));

  // Identify routes by name
  const routes = state.routes;
  const activeRouteName = routes[state.index]?.name;
  const isStudioActive = activeRouteName === 'studio';

  const handlePress = (routeName: string) => {
    const route = routes.find((r) => r.name === routeName);
    if (!route) return;
    const isFocused = activeRouteName === routeName;

    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });

    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  // Precise curved cutout notch geometry (curving around the R=32 button with ~6px clearance)
  const p0x = cx - 56;
  const c1x = cx - 44, c1y = 0;
  const c2x = cx - 39, c2y = 14;
  const p1x = cx - 33, p1y = 26;
  const c3x = cx - 22, c3y = 44;
  const c4x = cx - 12, c4y = 44;
  const p2x = cx,      p2y = 44;
  const c5x = cx + 12, c5y = 44;
  const c6x = cx + 22, c6y = 44;
  const p3x = cx + 33, p3y = 26;
  const c7x = cx + 39, c7y = 14;
  const c8x = cx + 44, c8y = 0;
  const p4x = cx + 56;

  const dFill = `M ${corner} 0 L ${p0x} 0 C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p1x} ${p1y} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${p2x} ${p2y} C ${c5x} ${c5y}, ${c6x} ${c6y}, ${p3x} ${p3y} C ${c7x} ${c7y}, ${c8x} ${c8y}, ${p4x} 0 L ${barWidth - corner} 0 A ${corner} ${corner} 0 0 1 ${barWidth} ${corner} L ${barWidth} ${barHeight - corner} A ${corner} ${corner} 0 0 1 ${barWidth - corner} ${barHeight} L ${corner} ${barHeight} A ${corner} ${corner} 0 0 1 0 ${barHeight - corner} L 0 ${corner} A ${corner} ${corner} 0 0 1 ${corner} 0 Z`;

  const dStroke = `M 0 ${barHeight - corner} L 0 ${corner} A ${corner} ${corner} 0 0 1 ${corner} 0 L ${p0x} 0 C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p1x} ${p1y} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${p2x} ${p2y} C ${c5x} ${c5y}, ${c6x} ${c6y}, ${p3x} ${p3y} C ${c7x} ${c7y}, ${c8x} ${c8y}, ${p4x} 0 L ${barWidth - corner} 0 A ${corner} ${corner} 0 0 1 ${barWidth} ${corner} L ${barWidth} ${barHeight - corner}`;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.rootContainer, { paddingBottom: bottomInset }]}
    >
      <View style={[styles.barWrapper, { width: barWidth, height: barHeight }]}>
        {/* SVG Curved Bar Background + Neon Glow Stroke */}
        <Svg
          width={barWidth}
          height={barHeight}
          viewBox={`0 0 ${barWidth} ${barHeight}`}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            {/* Neon Green/Cyan Gradient for Outer Border */}
            <LinearGradient id="neonGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#00F5D4" stopOpacity="1" />
              <Stop offset="25%" stopColor="#10B981" stopOpacity="1" />
              <Stop offset="50%" stopColor="#00F5D4" stopOpacity="1" />
              <Stop offset="75%" stopColor="#10B981" stopOpacity="1" />
              <Stop offset="100%" stopColor="#00F5D4" stopOpacity="1" />
            </LinearGradient>

            {/* Dark Black/Green Glassmorphic Background */}
            <LinearGradient id="barBg" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#081712" stopOpacity="0.96" />
              <Stop offset="100%" stopColor="#030806" stopOpacity="0.99" />
            </LinearGradient>
          </Defs>

          {/* Bar Solid Fill */}
          <Path d={dFill} fill="url(#barBg)" />

          {/* Outer Soft Neon Glow Stroke */}
          <Path
            d={dStroke}
            fill="none"
            stroke="url(#neonGlow)"
            strokeWidth={5}
            strokeOpacity={0.28}
            strokeLinecap="round"
          />

          {/* Medium Neon Stroke */}
          <Path
            d={dStroke}
            fill="none"
            stroke="url(#neonGlow)"
            strokeWidth={3}
            strokeOpacity={0.65}
            strokeLinecap="round"
          />

          {/* Crisp Inner Neon Stroke */}
          <Path
            d={dStroke}
            fill="none"
            stroke="url(#neonGlow)"
            strokeWidth={1.8}
            strokeOpacity={1}
            strokeLinecap="round"
          />
        </Svg>

        {/* Tab Items Layout Row */}
        <View style={styles.tabsRow}>
          {/* Left Wing: Dashboard & Projects */}
          <View style={styles.wingRow}>
            <TabButton
              label={TABS_CONFIG.index.label}
              Icon={TABS_CONFIG.index.Icon}
              isFocused={activeRouteName === 'index'}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                handlePress('index');
              }}
            />
            <TabButton
              label={TABS_CONFIG.projects.label}
              Icon={TABS_CONFIG.projects.Icon}
              isFocused={activeRouteName === 'projects'}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                handlePress('projects');
              }}
            />
          </View>

          {/* Center Space for Notch & Floating Button */}
          <View style={{ width: 112 }} />

          {/* Right Wing: Assistant & Settings */}
          <View style={styles.wingRow}>
            <TabButton
              label={TABS_CONFIG.assistant.label}
              Icon={TABS_CONFIG.assistant.Icon}
              isFocused={activeRouteName === 'assistant'}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                handlePress('assistant');
              }}
            />
            <TabButton
              label={TABS_CONFIG.settings.label}
              Icon={TABS_CONFIG.settings.Icon}
              isFocused={activeRouteName === 'settings'}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                handlePress('settings');
              }}
            />
          </View>
        </View>

        {/* "Studio" label under the center scooped notch */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            handlePress('studio');
          }}
          style={[styles.studioLabelWrapper, { left: cx - 40 }]}
          accessibilityRole="button"
          accessibilityLabel="Studio"
          accessibilityState={{ selected: isStudioActive }}
        >
          <Text
            style={[
              styles.studioLabel,
              isStudioActive ? styles.studioLabelActive : styles.studioLabelInactive,
            ]}
          >
            Studio
          </Text>
        </Pressable>

        {/* Center Floating PLUS Button (Design 01 Neon Floating + Design 04 Curved Notch) */}
        <View
          pointerEvents="box-none"
          style={[styles.floatingButtonAnchor, { left: cx - 36 }]}
        >
          {/* Pulsing Outer Glow Aura */}
          <Animated.View
            style={[
              styles.floatingGlowAura,
              isStudioActive && styles.floatingGlowAuraActive,
              glowAnimStyle,
            ]}
            pointerEvents="none"
          />

          {/* Rotating Sparkle Light Ring */}
          <Animated.View
            style={[styles.rotatingRingContainer, ringAnimStyle]}
            pointerEvents="none"
          >
            <Svg width={80} height={80} viewBox="0 0 80 80">
              <Circle
                cx={40}
                cy={40}
                r={36}
                stroke="#c084fc"
                strokeWidth={1.2}
                strokeDasharray="4 16"
                strokeOpacity={0.65}
              />
              <Circle cx={40} cy={4} r={2.2} fill="#e9d5ff" />
              <Circle cx={72} cy={22} r={1.6} fill="#c084fc" />
              <Circle cx={8} cy={22} r={1.6} fill="#a855f7" />
            </Svg>
          </Animated.View>

          {/* Interactive Floating PLUS Button */}
          <Animated.View style={floatingAnimStyle}>
            <Pressable
              onPressIn={() => {
                pressScale.value = withTiming(0.92, { duration: 100 });
              }}
              onPressOut={() => {
                pressScale.value = withSpring(1.0, { damping: 12, stiffness: 260 });
              }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                handlePress('studio');
              }}
              accessibilityRole="button"
              accessibilityLabel="Studio"
              accessibilityState={{ selected: isStudioActive }}
              style={styles.floatingButtonOuter}
            >
              <ExpoLinearGradient
                colors={['#d8b4fe', '#a855f7', '#7c3aed', '#581c87']}
                start={{ x: 0.15, y: 0.05 }}
                end={{ x: 0.85, y: 0.95 }}
                style={styles.floatingButtonInner}
              >
                {/* 3D Specular Highlight at Top Edge */}
                <View style={styles.specularHighlight} />

                {/* Actual PLUS (+) Icon (Design 01 specification) */}
                <View style={styles.plusContainer}>
                  <View style={styles.plusVertical} />
                  <View style={styles.plusHorizontal} />
                </View>
              </ExpoLinearGradient>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  barWrapper: {
    position: 'relative',
    shadowColor: '#00F5D4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
  tabsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  wingRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 54,
  },
  tabIconWrap: {
    marginBottom: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10.5,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontWeight: '500',
  },
  studioLabelWrapper: {
    position: 'absolute',
    top: 48,
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioLabel: {
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  studioLabelActive: {
    color: '#00F5D4',
    fontWeight: '700',
    textShadowColor: 'rgba(0, 245, 212, 0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  studioLabelInactive: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '500',
  },
  floatingButtonAnchor: {
    position: 'absolute',
    top: -26,
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingGlowAura: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(168, 85, 247, 0.35)',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.9,
    shadowRadius: 18,
    elevation: 16,
  },
  floatingGlowAuraActive: {
    backgroundColor: 'rgba(192, 132, 252, 0.5)',
    shadowColor: '#c084fc',
    shadowOpacity: 1,
    shadowRadius: 22,
  },
  rotatingRingContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingButtonOuter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2.5,
    backgroundColor: 'rgba(216, 180, 254, 0.45)',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.8,
    shadowRadius: 14,
    elevation: 14,
  },
  floatingButtonInner: {
    flex: 1,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  specularHighlight: {
    position: 'absolute',
    top: 1,
    left: 8,
    right: 8,
    height: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.75)',
  },
  plusContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusVertical: {
    position: 'absolute',
    width: 3.8,
    height: 22,
    borderRadius: 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 2,
  },
  plusHorizontal: {
    position: 'absolute',
    width: 22,
    height: 3.8,
    borderRadius: 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 2,
  },
});
