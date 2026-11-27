import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, ExternalLink, KeyRound, ShieldCheck, Sparkles, Wand2 } from 'lucide-react-native';
import { FadeInDown, FadeInRight, ZoomIn } from 'react-native-reanimated';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { setStep } from '../lib/onboarding';
import { useColors } from '../lib/theme';
import { Badge, Button, Card, ErrorBox, Field, Row, T } from '../components/ui';
import { Animated, Orbs, popIn } from '../components/motion';
import { toast } from '../components/Dialog';

type P = 'stitch' | 'gemini';
const INFO: Record<P, { name: string; does: string; url: string; site: string; steps: string[]; icon: typeof Sparkles; color: string }> = {
  stitch: {
    name: 'Google Stitch API', does: 'Designs UI screens, websites, and Logo & Brand Studio concepts.', url: 'https://stitch.withgoogle.com/settings', site: 'stitch.withgoogle.com', icon: Sparkles, color: '#7c5cff',
    steps: ['Tap “Open Stitch” below and sign in with Google', 'Open Settings → API keys', 'Tap “Create key” and copy it', 'Come back here, paste it and tap Connect'],
  },
  gemini: {
    name: 'Gemini API', does: 'Makes your short ideas smarter and powers the AI assistant.', url: 'https://aistudio.google.com/app/apikey', site: 'aistudio.google.com', icon: Wand2, color: '#ff7a45',
    steps: ['Tap “Open AI Studio” below and sign in with Google', 'Tap “Create API key”', 'Copy the key (starts with “AIza”)', 'Come back here, paste it and tap Connect'],
  },
};

function KeyCard({ p, index }: { p: P; index: number }) {
  const { me, refresh } = useAuth();
  const c = useColors();
  const i = INFO[p];
  const conn = me?.connections.find((x) => x.provider === p);
  const ok = !!conn?.connected;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [replace, setReplace] = useState(false);
  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/connections/${p}`, { apiKey: key.trim() });
      setKey(''); setReplace(false); await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast(`${i.name} connected ✓`);
    } catch (e) { setErr(e as ApiError); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined); } finally { setBusy(false); }
  };
  return (
    <Animated.View entering={FadeInDown.delay(150 + index * 140).springify().damping(16)}>
      <Card style={{ gap: 12, borderColor: ok ? c.green + '88' : i.color + '55', borderWidth: 1 }}>
        <Row>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: i.color + '22', alignItems: 'center', justifyContent: 'center' }}><i.icon size={20} color={i.color} /></View>
          <View style={{ flex: 1 }}><T weight="800">{i.name}</T><T muted size={12}>{i.does}</T></View>
          {ok ? <Animated.View entering={ZoomIn.springify()}><CheckCircle2 size={26} color={c.green} /></Animated.View> : <Badge label={conn?.status === 'invalid' ? 'Re-enter' : 'Required'} tone="amber" />}
        </Row>
        {ok && !replace ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <T size={13} style={{ color: c.green }}>Connected · key ••••{conn?.keyHint?.replace('…', '')}</T>
            <Pressable onPress={() => setReplace(true)} hitSlop={8}><T size={13} style={{ color: c.primary }}>Change</T></Pressable>
          </Row>
        ) : (
          <View style={{ gap: 10 }}>
            {conn?.status === 'invalid' && <T size={12} style={{ color: c.amber }}>Your saved key can't be used anymore — please paste it again once.</T>}
            {i.steps.map((s, n) => (
              <Animated.View key={s} entering={FadeInRight.delay(250 + n * 80)}>
                <Row style={{ alignItems: 'flex-start' }} gap={10}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: i.color, alignItems: 'center', justifyContent: 'center' }}><T size={11} weight="800" style={{ color: '#fff', lineHeight: 14 }}>{n + 1}</T></View>
                  <T size={13} style={{ flex: 1 }}>{s}</T>
                </Row>
              </Animated.View>
            ))}
            <Button small variant="secondary" title={`Open ${p === 'stitch' ? 'Stitch' : 'AI Studio'} · ${i.site}`} icon={<ExternalLink size={14} color={c.text} />} onPress={() => Linking.openURL(i.url)} />
            <Field value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={`Paste your ${p === 'stitch' ? 'Stitch' : 'Gemini'} API key`} importantForAutofill="no" />
            <ErrorBox error={err} />
            <Button title={busy ? 'Verifying…' : 'Connect'} icon={<KeyRound size={16} color="#fff" />} loading={busy} disabled={key.trim().length < 20} onPress={connect} />
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

/** Screen 2 of the first-run flow: connect the user's own Stitch + Gemini keys. */
export default function SetupKeys() {
  const { me } = useAuth();
  const c = useColors();
  const both = ['stitch', 'gemini'].every((p) => me?.connections.find((x) => x.provider === p)?.connected);
  const next = () => { if (me) setStep(me.user.uid, 'permissions'); };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Orbs />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Animated.View entering={popIn} style={{ gap: 6, marginTop: 8 }}>
            <Row><View style={{ height: 6, flex: 1, borderRadius: 3, backgroundColor: c.primary }} /><View style={{ height: 6, flex: 1, borderRadius: 3, backgroundColor: c.primary }} /><View style={{ height: 6, flex: 1, borderRadius: 3, backgroundColor: c.border }} /></Row>
            <T muted size={12}>Step 2 of 3</T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(60).springify()} style={{ gap: 6 }}>
            <T size={26} weight="800">Connect your AI keys</T>
            <T muted>Designo uses your own free Google keys. Turn on both so everything works — designs, smart prompts and the Assistant.</T>
          </Animated.View>
          <KeyCard p="stitch" index={0} />
          <KeyCard p="gemini" index={1} />
          <Row style={{ alignItems: 'flex-start' }}><ShieldCheck size={16} color={c.green} /><T muted size={12} style={{ flex: 1 }}>Keys are verified, then stored encrypted (AES-256) on our server — never in this phone and never shared. You can change them any time in Settings → Integrations.</T></Row>
          <Button title={both ? 'Continue' : 'Connect both keys to continue'} disabled={!both} onPress={next} />
          {!both && <Pressable onPress={next} hitSlop={8} style={{ alignSelf: 'center' }}><T muted size={13}>Skip for now</T></Pressable>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
