import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Animated } from './motion';

const SRC = require('../assets/logo.png');

/**
 * Circular DesignForge logo. When `animated`: a violet→ember ring slowly rotates around it and a soft
 * glow breathes behind it (UI-thread Reanimated, static when the system "remove animations" is on).
 */
export function Logo({ size = 84, animated = true, ring = true }: { size?: number; animated?: boolean; ring?: boolean }) {
  const reduce = useReducedMotion();
  const spin = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (animated && !reduce) {
      spin.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1, false);
      glow.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })), -1, false);
    }
    return () => { cancelAnimation(spin); cancelAnimation(glow); };
  }, [animated, reduce, spin, glow]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + glow.value * 0.12 }], opacity: 0.35 + glow.value * 0.35 }));
  const pad = ring ? Math.round(size * 0.08) : 0;
  const outer = size + pad * 2;
  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Designo logo">
      <Animated.View style={[{ position: 'absolute', width: outer * 1.25, height: outer * 1.25, borderRadius: outer }, glowStyle]}>
        <LinearGradient colors={['#7c5cff55', '#ff7a4500']} start={{ x: 0.2, y: 0.2 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: outer }} />
      </Animated.View>
      {ring && (
        <Animated.View style={[{ position: 'absolute', width: outer, height: outer, borderRadius: outer / 2, overflow: 'hidden' }, ringStyle]}>
          <LinearGradient colors={['#7c5cff', '#ff7a45', '#38bdf8', '#7c5cff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
        </Animated.View>
      )}
      {ring && <View style={{ position: 'absolute', width: size + pad, height: size + pad, borderRadius: size, backgroundColor: '#0a0a0f' }} />}
      <Image source={SRC} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" fadeDuration={0} />
    </View>
  );
}
