import { useEffect } from 'react';
import { View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Animated, Float, Orbs, popIn } from '../components/motion';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { DialogHost } from '../components/Dialog';
import { ServerWakeBanner } from '../components/ServerWakeBanner';

function Gate() {
  const { me, loading } = useAuth();
  const seg = useSegments();
  const router = useRouter();
  const c = useColors();
  useEffect(() => {
    if (loading) return;
    const inLogin = seg[0] === 'login';
    if (!me && !inLogin) router.replace('/login');
    else if (me && inLogin) router.replace('/');
  }, [me, loading, seg, router]);
  // Tapping a push notification deep-links into the project.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as { projectId?: string; kind?: string };
      if (d?.projectId) router.push(`/project/${d.projectId}`);
      else if (d?.kind === 'billing') router.push('/billing');
    });
    return () => sub.remove();
  }, [router]);
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Loading DesignForge">
      <Orbs />
      <Animated.View entering={popIn}><Float amplitude={8}><View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><Sparkles color="#fff" size={40} /></View></Float></Animated.View>
    </View>
  );
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false, animation: 'ios_from_right', animationDuration: 280, gestureEnabled: true }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="integrations" options={{ title: 'Integrations' }} />
      <Stack.Screen name="billing" options={{ title: 'Plans & credits' }} />
      <Stack.Screen name="logo" options={{ title: 'Logo Studio' }} />
      <Stack.Screen name="improve" options={{ title: 'Improve a design' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', animation: 'fade_from_bottom' }} />
      <Stack.Screen name="support" options={{ title: 'Help & support' }} />
    </Stack>
  );
}

export default function Root() {
  // DialogHost sits above the navigator so animated dialogs/toasts overlay every screen.
  return <SafeAreaProvider><AuthProvider><StatusBar style="auto" /><View style={{ flex: 1 }}><Gate /><ServerWakeBanner /><DialogHost /></View></AuthProvider></SafeAreaProvider>;
}
