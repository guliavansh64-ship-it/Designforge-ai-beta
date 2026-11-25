import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import { Animated } from '../../components/motion';
import { LayoutDashboard, Sparkles, FolderKanban, MessageSquare, Settings } from 'lucide-react-native';
import { useColors } from '../../lib/theme';

/** Tab icon that springs up + bounces when its tab becomes active. */
function TabIcon({ Icon, color, focused }: { Icon: typeof Settings; color: string; focused: boolean }) {
  const s = useSharedValue(focused ? 1 : 0);
  useEffect(() => { s.value = focused ? withSequence(withSpring(1.25, { damping: 8, stiffness: 300 }), withSpring(1, { damping: 12 })) : withSpring(1, { damping: 14 }); }, [focused, s]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: focused ? s.value : 1 }, { translateY: focused ? -2 : 0 }] }));
  return <Animated.View style={a}><Icon color={color} size={22} /></Animated.View>;
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border }, tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.muted, sceneStyle: { backgroundColor: c.bg }, animation: 'shift' }} screenListeners={{ tabPress: () => { Haptics.selectionAsync().catch(() => undefined); } }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color, focused }) => <TabIcon Icon={LayoutDashboard} color={color} focused={focused} /> }} />
      <Tabs.Screen name="studio" options={{ title: 'Studio', tabBarIcon: ({ color, focused }) => <TabIcon Icon={Sparkles} color={color} focused={focused} /> }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: ({ color, focused }) => <TabIcon Icon={FolderKanban} color={color} focused={focused} /> }} />
      <Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: ({ color, focused }) => <TabIcon Icon={MessageSquare} color={color} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, focused }) => <TabIcon Icon={Settings} color={color} focused={focused} /> }} />
    </Tabs>
  );
}
