import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Sparkles, Coins, Plug, Dumbbell, UtensilsCrossed, Store, Palette, Layers, Rocket } from 'lucide-react-native';
import { Easing, FadeInDown, FadeInUp, cancelAnimation, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Button, Card, ErrorBox, Row, T } from '../../components/ui';
import { Animated, Float, PressScale } from '../../components/motion';

/**
 * One box, one button. Everything else is automatic on the server: one screen vs a full app,
 * number of screens, device, theme & style, Stitch model, and a hidden prompt enhancement
 * (Gemini with the user's own key, else the built-in planner) that is sent only to Stitch.
 */
const IDEAS = [
  { t: 'A creative fitness app', icon: Dumbbell, col: '#7c5cff' },
  { t: 'A food delivery app', icon: UtensilsCrossed, col: '#ff7a45' },
  { t: 'A website for my bakery', icon: Store, col: '#38bdf8' },
];
const STEPS = [
  { icon: Palette, t: 'Style picked for you' },
  { icon: Layers, t: 'All screens designed' },
  { icon: Rocket, t: 'Preview & export' },
];
const isWebsite = (p: string) => /\b(website|web ?site|landing ?page|web ?page|homepage|portfolio site|blog site)\b/i.test(p);

/** Input box whose border slowly shifts violet → ember while focused. */
function GlowBox({ children, focused }: { children: React.ReactNode; focused: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (focused && !reduce) t.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true);
    else { cancelAnimation(t); t.value = withTiming(0, { duration: 200 }); }
    return () => cancelAnimation(t);
  }, [focused, reduce, t]);
  const a = useAnimatedStyle(() => ({ borderColor: focused ? interpolateColor(t.value, [0, 1], [c.primary, c.ember]) : c.border }));
  return <Animated.View style={[{ borderWidth: 1.5, borderRadius: 20, backgroundColor: c.card, padding: 4 }, a]}>{children}</Animated.View>;
}

export default function Studio() {
  const params = useLocalSearchParams<{ kind?: string; prompt?: string }>();
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [prompt, setPrompt] = useState(typeof params.prompt === 'string' ? params.prompt : '');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const stitchOn = !!me?.connections.find((x) => x.provider === 'stitch')?.connected;

  const go = async () => {
    setBusy(true); setErr(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    let created: Project | null = null;
    try {
      const web = (isWebsite(prompt) || params.kind === 'website') && !!me?.plan.features.includes('website_studio');
      // "Untitled" is renamed by the server to the planned app name.
      const { project } = await api.post<{ project: Project }>('/projects', { name: 'Untitled', kind: web ? 'website' : 'ui', deviceType: web ? 'DESKTOP' : 'MOBILE' });
      created = project;
      const { job } = await api.post<{ job: { id: string } }>(`/projects/${project.id}/generate`, { prompt: prompt.trim(), pageId: project.pages[0].id, idempotencyKey: newKey(), auto: true });
      refresh(); setPrompt('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.push(`/project/${project.id}?job=${job.id}`);
    } catch (e) {
      // Generation never started: remove the empty project so it doesn't clutter the list or count toward limits.
      if (created) api.del(`/projects/${created.id}`).catch(() => undefined);
      setErr(e as ApiError);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <Animated.View entering={FadeInDown.springify().damping(16)}>
          <LinearGradient colors={[c.primary + '40', c.ember + '26', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 20, gap: 8, borderWidth: 1, borderColor: c.primary + '33' }}>
            <Row>
              <Float amplitude={4}><View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><Sparkles size={22} color="#fff" /></View></Float>
              <View style={{ flex: 1 }}><T size={22} weight="800">What will you create?</T><T muted size={13}>One line is enough — AI does the rest.</T></View>
            </Row>
          </LinearGradient>
        </Animated.View>

        {me && !stitchOn && (
          <Card index={0} style={{ gap: 8, borderColor: c.amber + '88' }}>
            <Row><Plug size={18} color={c.amber} /><T weight="700" style={{ flex: 1 }}>Connect Google Stitch first</T></Row>
            <T muted size={12}>Designs are generated in your own Stitch account. It takes a minute.</T>
            <Button small title="Connect Stitch" onPress={() => router.push('/integrations')} />
          </Card>
        )}

        {/* Prompt */}
        <Animated.View entering={FadeInDown.delay(90).springify().damping(16)}>
          <GlowBox focused={focused}>
            <TextInput multiline value={prompt} onChangeText={setPrompt} maxLength={4000} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder="e.g. A creative fitness app" placeholderTextColor={c.muted} textAlignVertical="top"
              style={{ minHeight: 130, color: c.text, fontSize: 17, padding: 14, lineHeight: 24 }} accessibilityLabel="Describe what you want to build" />
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 }}>
              <T muted size={11}>{prompt.length ? `${prompt.length}/4000` : 'Short is fine'}</T>
              <Row gap={4}><Coins size={12} color={c.amber} /><T muted size={11}>5 credits / screen</T></Row>
            </Row>
          </GlowBox>
        </Animated.View>

        {/* 3 ideas */}
        <View style={{ gap: 10 }}>
          <T muted size={12} weight="700" style={{ letterSpacing: 1 }}>TRY ONE</T>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            {IDEAS.map((i, n) => (
              <Animated.View key={i.t} entering={FadeInUp.delay(160 + n * 90).springify().damping(14)} style={{ flexGrow: 1, flexBasis: '30%' }}>
                <PressScale onPress={() => { Haptics.selectionAsync().catch(() => undefined); setPrompt(i.t); }} accessibilityLabel={i.t}
                  style={{ backgroundColor: prompt === i.t ? i.col + '33' : c.card, borderWidth: 1, borderColor: prompt === i.t ? i.col : c.border, borderRadius: 18, padding: 12, gap: 8, alignItems: 'center', minHeight: 96, justifyContent: 'center' }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: i.col + '22', alignItems: 'center', justifyContent: 'center' }}><i.icon size={19} color={i.col} /></View>
                  <T size={12} weight="600" style={{ textAlign: 'center' }} numberOfLines={2}>{i.t}</T>
                </PressScale>
              </Animated.View>
            ))}
          </Row>
        </View>

        <ErrorBox error={err} />
        <Animated.View entering={FadeInUp.delay(420).springify()}>
          <Button title={busy ? 'Starting…' : 'Generate design'} icon={<Sparkles color="#fff" size={18} />} loading={busy} disabled={prompt.trim().length < 5 || (!!me && !stitchOn)} onPress={go} style={{ minHeight: 56, borderRadius: 28 }} />
        </Animated.View>

        {/* How it works */}
        <Row style={{ justifyContent: 'space-between' }}>
          {STEPS.map((s, n) => (
            <Animated.View key={s.t} entering={FadeInUp.delay(520 + n * 90)} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' }}><s.icon size={16} color={c.primary} /></View>
              <T muted size={11} style={{ textAlign: 'center' }}>{s.t}</T>
            </Animated.View>
          ))}
        </Row>
        <T muted size={11} style={{ textAlign: 'center' }}>Credits are refunded automatically if anything fails.</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
