import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, ShieldCheck, Wand2, Download, AlertTriangle } from 'lucide-react-native';
import { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { firebaseConfigured } from '../lib/firebase';
import { API_OVERRIDE_ALLOWED } from '../lib/api';
import { ServerUrlCard, useApiUrl } from '../components/ServerUrlCard';
import { useColors } from '../lib/theme';
import { Button, Card, Row, T } from '../components/ui';
import { Animated, Float, Orbs, popIn } from '../components/motion';

const FEATURES: [typeof Sparkles, string][] = [
  [Sparkles, 'Generate app screens & websites'],
  [Wand2, 'Audit → fix → compare improvements'],
  [Download, 'Export HTML or React + TypeScript'],
];

export default function Login() {
  const { signIn, error } = useAuth();
  const c = useColors();
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const apiUrl = useApiUrl();
  const configured = firebaseConfigured && !!apiUrl && !!webClientId;
  const missing = [!firebaseConfigured && 'Firebase config', !apiUrl && 'API URL', !webClientId && 'Google web client ID'].filter(Boolean).join(', ');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Orbs />
      {/* ScrollView + flexGrow keeps the layout readable on small screens and with large font sizes. */}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 28, justifyContent: 'space-between' }} showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: 24, gap: 14 }}>
          <Animated.View entering={popIn.delay(80)}>
            <Float amplitude={5}>
              <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', shadowColor: c.primary, shadowOpacity: 0.6, shadowRadius: 18, elevation: 12 }}>
                <Sparkles color="#fff" size={30} />
              </View>
            </Float>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(180).springify().damping(16)}>
            <T size={32} weight="800" style={{ lineHeight: 38 }}>Design, refine and ship with your own AI.</T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(280).springify().damping(16)}>
            <T muted>DesignForge AI turns prompts into UI, websites and brands — using your own Google Stitch account.</T>
          </Animated.View>
        </View>

        <View style={{ gap: 14 }}>
          {FEATURES.map(([I, t], i) => (
            <Animated.View key={t} entering={FadeInDown.delay(380 + i * 90).springify().damping(16)}>
              <Row gap={12}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.primary + '1f', alignItems: 'center', justifyContent: 'center' }}><I size={18} color={c.primary} /></View>
                <T style={{ flex: 1 }}>{t}</T>
              </Row>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.delay(650).springify().damping(16)} style={{ gap: 12 }}>
          {!configured && !(API_OVERRIDE_ALLOWED && firebaseConfigured && webClientId) && (
            <Card style={{ borderColor: c.amber + '88', gap: 6 }}>
              <Row style={{ alignItems: 'flex-start' }}><AlertTriangle size={18} color={c.amber} /><T weight="700" style={{ color: c.amber, flex: 1 }}>Preview build — not connected to a server yet</T></Row>
              <T muted size={12}>{API_OVERRIDE_ALLOWED ? 'Sign-in is disabled until a server URL is set. Enter your API address below.' : 'Sign-in is disabled because this APK was built without a backend address and Firebase project. Rebuild with your values (see docs/09-WHAT-I-NEED.md).'}</T>
              <T muted size={11}>Missing: {missing}</T>
            </Card>
          )}
          {/* Only shown for builds without a built-in server address (never in the release APK). */}
          {!configured && <ServerUrlCard inline />}
          <Button title="Continue with Google" onPress={signIn} disabled={!configured} />
          {error && configured && <Card style={{ borderColor: c.red }}><T size={13} style={{ color: c.red }}>{error}</T></Card>}
          <Row style={{ alignItems: 'flex-start' }}><ShieldCheck size={16} color={c.green} /><T muted size={12} style={{ flex: 1 }}>We only request your basic Google profile. Connecting Stitch is a separate step you control. We never see your Google password.</T></Row>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
