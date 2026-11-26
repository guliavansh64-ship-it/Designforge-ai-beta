import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onServerSlow } from '../lib/api';
import { useColors } from '../lib/theme';
import { Animated, Pulse } from './motion';
import { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { T } from './ui';

/**
 * Shown when any request takes longer than ~3.5 s, typically the free Render server waking up after
 * 15 minutes idle (about 30–50 s). Tells the user the app isn't frozen.
 */
export function ServerWakeBanner() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [slow, setSlow] = useState(false);
  useEffect(() => onServerSlow(setSlow), []);
  if (!slow) return null;
  return (
    <Animated.View entering={SlideInUp.springify().damping(16)} exiting={FadeOutUp.duration(200)} pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 6, left: 16, right: 16, zIndex: 50, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, elevation: 6 }}>
        <Pulse color={c.amber} size={7} />
        <T size={12}>Waking up the server… first load can take ~30 s</T>
      </View>
    </Animated.View>
  );
}
