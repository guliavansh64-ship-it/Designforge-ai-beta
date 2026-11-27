import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CurvedTabBar, tabBarSpace } from '../../components/CurvedTabBar';
import { useColors } from '../../lib/theme';

/** Hides the floating bar while the keyboard is open (Android resizes the window, the bar would ride on top of the keyboard). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

/**
 * Five destinations: Dashboard · Projects · (+) Studio · Assistant · Settings.
 * The curved bar floats over the bottom of each screen, so every screen keeps `tabBarSpace` free at the bottom.
 * Back on Android: from any tab → Dashboard, then exits (React Navigation `firstRoute`).
 */
export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardOpen();
  return (
    <Tabs
      backBehavior="firstRoute"
      tabBar={(props) => <CurvedTabBar {...props} hidden={kb} />}
      screenOptions={{
        headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false,
        sceneStyle: { backgroundColor: c.bg, paddingBottom: kb ? 0 : tabBarSpace(insets.bottom) },
        animation: 'shift',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="studio" options={{ title: 'Studio' }} />
      <Tabs.Screen name="assistant" options={{ title: 'Assistant' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
