import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ShieldCheck, Smartphone, Globe, Wand2 } from 'lucide-react-native';
import { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../lib/auth';
import { firebaseConfigured } from '../lib/firebase';
import { useColors } from '../lib/theme';
import { Card, Row, T } from '../components/ui';
import { Animated, Orbs, PressScale, popIn } from '../components/motion';
import { Logo } from '../components/Logo';

function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Svg>
  );
}

const FEATURES: [typeof Smartphone, string, string][] = [
  [Smartphone, 'Full apps from one line', 'Type “a fitness app” — get every screen'],
  [Globe, 'Websites & landing pages', 'Responsive, ready to export'],
  [Wand2, 'Ask the assistant for free', 'Questions about your projects cost nothing'],
];

/** Screen 1 of the first-run flow: sign in with Google. */
export default function Login() {
  const { signIn, error, user } = useAuth();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const signingIn = busy || (!!user && !error); // Firebase session restored, profile still loading
  const configured = firebaseConfigured && !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  const go = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setBusy(true);
    try { await signIn(); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Orbs />
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 28, justifyContent: 'space-between' }} showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: 36, gap: 18, alignItems: 'center' }}>
          <Animated.View entering={popIn.delay(60)}><Logo size={108} /></Animated.View>
          <Animated.View entering={FadeInDown.delay(180).springify().damping(16)} style={{ alignItems: 'center', gap: 8 }}>
            <T size={30} weight="800" style={{ textAlign: 'center', lineHeight: 36 }}>Designo</T>
            <T muted style={{ textAlign: 'center' }}>Describe an idea. Get a beautiful app or website — designed by AI in seconds.</T>
          </Animated.View>
        </View>

        <View style={{ gap: 12 }}>
          {FEATURES.map(([I, t, sub], i) => (
            <Animated.View key={t} entering={FadeInDown.delay(320 + i * 110).springify().damping(15)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.primary + '22', alignItems: 'center', justifyContent: 'center' }}><I size={20} color={c.primary} /></View>
                <View style={{ flex: 1 }}><T weight="700" size={14}>{t}</T><T muted size={12}>{sub}</T></View>
              </Card>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.delay(700).springify().damping(16)} style={{ gap: 14 }}>
          <PressScale onPress={go} disabled={!configured || signingIn} accessibilityRole="button" accessibilityLabel="Sign in with Google"
            style={{ backgroundColor: '#ffffff', borderRadius: 28, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: configured ? 1 : 0.5, shadowColor: c.primary, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 }}>
            {signingIn ? <ActivityIndicator color="#1f1f1f" /> : <GoogleG size={22} />}
            <Text style={{ color: '#1f1f1f', fontSize: 16, fontWeight: '700' }}>{signingIn ? 'Signing you in…' : 'Sign in with Google'}</Text>
          </PressScale>
          {!configured && <T size={12} style={{ color: c.amber, textAlign: 'center' }}>Sign-in is not available in this build.</T>}
          {error && configured && !signingIn && <Animated.View entering={FadeInDown}><Card style={{ borderColor: c.red }}><T size={13} style={{ color: c.red }}>{error}</T></Card></Animated.View>}
          <Row style={{ justifyContent: 'center' }}><ShieldCheck size={14} color={c.green} /><T muted size={12}>Only your basic Google profile · we never see your password</T></Row>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
