import { useEffect } from 'react';
import { View } from 'react-native';
import { Animated, Orbs, popIn } from '../components/motion';
import { Logo } from '../components/Logo';
import { PlanExpiredModal } from '../components/PlanExpiredModal';
import { useOnboardingStep } from '../lib/onboarding';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { DialogHost } from '../components/Dialog';
import { ServerWakeBanner } from '../components/ServerWakeBanner';
import { ensureChannels } from '../lib/push';

ensureChannels().catch(() => undefined);

let handledTap: string | null = null;

function Gate() {
  const { me, loading } = useAuth();
  const seg = useSegments();
  const router = useRouter();
  const c = useColors();
  const step = useOnboardingStep(me?.user.uid);
  // Flow: Google sign-in → API keys (Stitch + Gemini) → permissions → main app.
  useEffect(() => {
    if (loading) return;
    const at = seg[0] as string | undefined;
    const inLogin = at === 'login';
    if (!me) { if (!inLogin) router.replace('/login'); return; }
    if (!step) return;
    if (step === 'keys' && at !== 'setup-keys') router.replace('/setup-keys');
    else if (step === 'permissions' && at !== 'setup-permissions') router.replace('/setup-permissions');
    else if (step === 'done' && (inLogin || at === 'setup-keys' || at === 'setup-permissions')) router.replace('/');
  }, [me, loading, seg, router, step]);
  // Tapping a push notification deep-links into the right screen — also when the tap is what
  // launched the app from a fully CLOSED state (cold start), which the listener alone would miss.
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const d = (r.notification.request.content.data ?? {}) as { projectId?: string; kind?: string; type?: string };
      if (d.projectId) router.push(`/project/${d.projectId}`);
      else if (d.kind === 'billing' || d.type?.startsWith('payment') || d.type === 'credits_low' || d.type?.startsWith('subscription')) router.push('/billing');
      else if (d.kind === 'studio') router.push('/(tabs)/studio');
      else if (d.kind === 'projects') router.push('/(tabs)/projects');
      else router.push('/notifications');
    };
    if (!loading && me) {
      Notifications.getLastNotificationResponseAsync().then((r) => {
        if (r && handledTap !== r.notification.request.identifier) { handledTap = r.notification.request.identifier; setTimeout(() => open(r), 500); }
      }).catch(() => undefined);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => { handledTap = r.notification.request.identifier; open(r); });
    return () => sub.remove();
  }, [router, loading, me]);
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Loading DesignForge">
      <Orbs />
      <Animated.View entering={popIn}><Logo size={96} /></Animated.View>
    </View>
  );
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false, animation: 'ios_from_right', animationDuration: 280, gestureEnabled: true }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="setup-keys" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="setup-permissions" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="billing-history" options={{ title: 'Payment history' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
      <Stack.Screen name="preview/[id]" options={{ headerShown: false, animation: 'fade_from_bottom' }} />
      <Stack.Screen name="integrations" options={{ title: 'Integrations' }} />
      <Stack.Screen name="billing" options={{ title: 'Plans & credits' }} />
      <Stack.Screen name="logo" options={{ title: 'Logo Studio' }} />
      <Stack.Screen name="improve" options={{ title: 'Improve a design' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', animation: 'fade_from_bottom' }} />
      <Stack.Screen name="support" options={{ title: 'Help & support' }} />
    </Stack>
  );
}

/** Shows the "plan expired" pop-up only inside the main app (not during sign-in / setup). */
function ExpiryWatcher() {
  const { me } = useAuth();
  const seg = useSegments();
  const step = useOnboardingStep(me?.user.uid);
  if (!me || step !== 'done' || seg[0] === 'login' || String(seg[0]).startsWith('setup')) return null;
  return <PlanExpiredModal />;
}

export default function Root() {
  // DialogHost sits above the navigator so animated dialogs/toasts overlay every screen.
  return <SafeAreaProvider><AuthProvider><StatusBar style="auto" /><View style={{ flex: 1 }}><Gate /><ServerWakeBanner /><ExpiryWatcher /><DialogHost /></View></AuthProvider></SafeAreaProvider>;
}
