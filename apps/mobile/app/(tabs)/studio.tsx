import * as Haptics from 'expo-haptics';
import { STITCH_MODELS, normalizeModel, type StitchModel } from '../../lib/models';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Sparkles, Smartphone, Tablet, Monitor, Coins, Wand2, LayoutGrid, Square, Bot } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useColors } from '../../lib/theme';
import type { DesignPlan, Project } from '../../lib/types';
import { PlanCard } from '../../components/PlanCard';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../../components/ui';
import { Animated, Appear, Swap } from '../../components/motion';
import { FadeInDown } from 'react-native-reanimated';

const STYLES = ['Clean & minimal', 'Bold & vibrant', 'Dark & premium', 'Playful', 'Corporate', 'Editorial'];
const IDEAS = { ui: ['Create a fitness app', 'Food delivery app for a cloud kitchen in Delhi', 'Fintech home screen with balance card, quick actions and recent transactions', 'Habit tracker onboarding screen with 3 benefits and a Get started button'], website: ['Website for an Ayurvedic clinic in Jaipur: services, doctors, testimonials, booking CTA', 'Landing page for a B2B invoicing SaaS with pricing and FAQ'] };

export default function Studio() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [kind, setKind] = useState<'ui' | 'website'>(params.kind === 'website' ? 'website' : 'ui');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>(params.kind === 'website' ? 'DESKTOP' : 'MOBILE');
  const [model, setModel] = useState<StitchModel>(normalizeModel(me?.preferences?.defaultModel));
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  // Prompt enhancement + full-app generation
  const [mode, setMode] = useState<'auto' | 'single' | 'app'>('auto');
  const [screens, setScreens] = useState(4);
  const [enhanceOn, setEnhanceOn] = useState(true);
  const [plan, setPlan] = useState<{ plan: DesignPlan; forPrompt: string; forKey: string } | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const geminiOn = !!me?.connections.find((x) => x.provider === 'gemini')?.connected;
  const planKey = `${kind}|${mode}|${screens}|${style}|${device}`;
  const activePlan = enhanceOn && plan && plan.forPrompt === prompt && plan.forKey === planKey ? plan.plan : null;
  const per = 2; // server CREDIT_COSTS.generate_flash (per screen)
  const costLabel = activePlan ? `${activePlan.screens.length * per} credits · ${activePlan.screens.length} ${activePlan.screens.length > 1 ? 'screens' : 'screen'}`
    : mode === 'app' ? `${screens * per} credits · ${screens} screens × ${per}`
    : mode === 'auto' && enhanceOn ? `${per} credits per screen · up to ${screens} screens for a full app`
    : `${per} credits`;

  const enhanceNow = async () => {
    setEnhancing(true); setErr(null);
    try {
      const r = await api.post<{ plan: DesignPlan }>('/prompt/enhance', { prompt, kind, deviceType: device, style: style || undefined, mode, maxScreens: screens });
      setPlan({ plan: r.plan, forPrompt: prompt, forKey: planKey });
      Haptics.selectionAsync().catch(() => undefined);
    } catch (e) { setErr(e as ApiError); } finally { setEnhancing(false); }
  };

  const go = async () => {
    setBusy(true); setErr(null);
    let created: Project | null = null;
    try {
      const autoName = activePlan?.isFullApp ? activePlan.appName : name.trim() ? '' : (mode !== 'single' ? 'Untitled' : '');
      const { project } = await api.post<{ project: Project }>('/projects', { name: name.trim() || autoName || prompt.split(/[.,\n]/)[0].slice(0, 60) || 'Untitled', kind, deviceType: device });
      created = project;
      const { job } = await api.post<{ job: { id: string } }>(`/projects/${project.id}/generate`, {
        prompt, deviceType: device, model, pageId: project.pages[0].id, style: style || undefined, idempotencyKey: newKey(),
        enhance: enhanceOn, mode: enhanceOn ? mode : (mode === 'app' ? 'app' : 'single'), maxScreens: screens, plan: activePlan ?? undefined,
      });
      refresh(); setPrompt(''); setName(''); setPlan(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.push(`/project/${project.id}?job=${job.id}`);
    } catch (e) {
      // Generation never started: remove the empty project we just made so it doesn't clutter the list or count toward limits.
      if (created) api.del(`/projects/${created.id}`).catch(() => undefined);
      setErr(e as ApiError);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Appear><Row><Chip label="App UI" active={kind === 'ui'} onPress={() => { setKind('ui'); setDevice('MOBILE'); }} /><Chip label="Website" active={kind === 'website'} onPress={() => { setKind('website'); setDevice('DESKTOP'); }} /></Row></Appear>
        {kind === 'website' && !me?.plan.features.includes('website_studio') && <ErrorBox error={Object.assign(new Error('Website Studio is available on Pro and above.'), { action: 'upgrade_plan' }) as any} />}
        <Card index={1} style={{ gap: 12 }}>
          <View><Label>Project name</Label><Field value={name} onChangeText={setName} placeholder={kind === 'website' ? 'Ember & Oak Café' : 'Pulse fintech app'} maxLength={80} /></View>
          <View><Label>{kind === 'website' ? 'Business brief' : 'Describe your app or screen'}</Label>
            <Field multiline value={prompt} onChangeText={setPrompt} maxLength={4000} style={{ minHeight: 140 }} placeholder={kind === 'website' ? 'e.g. Website for my bakery in Gurugram' : 'e.g. Create a fitness app — or describe one screen in detail'} />
            <T muted size={11} style={{ textAlign: 'right', marginTop: 4 }}>{prompt.length}/4000</T></View>
          {enhanceOn && <Button small variant="secondary" title={activePlan ? 'Re-enhance prompt' : 'Enhance prompt & preview plan (free)'} icon={<Wand2 size={16} color={c.text} />} loading={enhancing} disabled={prompt.trim().length < 3} onPress={enhanceNow} />}
          {activePlan && <Animated.View entering={FadeInDown.springify().damping(18)}><PlanCard plan={activePlan} /></Animated.View>}
          <Swap id={kind} style={{ gap: 6 }}>{IDEAS[kind].map((i) => <Chip key={i} label={i.length > 52 ? i.slice(0, 52) + '…' : i} onPress={() => setPrompt(i)} />)}</Swap>
        </Card>
        <Card index={2} style={{ gap: 12 }}>
          <Label>What to build</Label>
          <Row>{([['auto', 'Auto', Bot], ['single', 'One screen', Square], ['app', 'Full app', LayoutGrid]] as const).map(([m, l, I]) => (
            <Button key={m} small variant={mode === m ? 'primary' : 'secondary'} title={l} icon={<I size={15} color={mode === m ? '#fff' : c.text} />} onPress={() => setMode(m)} style={{ flex: 1 }} />
          ))}</Row>
          <T muted size={12}>{mode === 'auto' ? 'Short ideas like “create a fitness app” become a complete multi-screen app; a detailed single-screen request stays one screen.' : mode === 'app' ? `A complete ${kind === 'website' ? 'website' : 'app'} — ${screens} ${kind === 'website' ? 'pages' : 'screens'} with one shared theme, navigation and realistic content.` : 'Exactly one screen.'}</T>
          {mode !== 'single' && <Row>{[3, 4, 5, 6].map((n) => <Chip key={n} label={`${n} ${kind === 'website' ? 'pages' : 'screens'}`} active={screens === n} onPress={() => setScreens(n)} />)}</Row>}
          <Row style={{ alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <T weight="600" size={14}>Enhance prompt {geminiOn ? 'with Gemini' : ''}</T>
              <T muted size={12}>{geminiOn ? 'Your own Gemini key turns your idea into a detailed design brief before it goes to Stitch.' : 'Built-in enhancer is used. Connect your Gemini key in Integrations for AI-written briefs.'}</T>
            </View>
            <Switch value={enhanceOn} onValueChange={setEnhanceOn} trackColor={{ true: c.primary, false: c.border }} accessibilityLabel="Enhance prompt" />
          </Row>
          {!geminiOn && enhanceOn && <Button small variant="ghost" title="Connect Gemini" onPress={() => router.push('/integrations')} />}
          <Label>Device</Label>
          <Row>{([['MOBILE', Smartphone], ['TABLET', Tablet], ['DESKTOP', Monitor]] as const).map(([d, I]) => (
            <Button key={d} small variant={device === d ? 'primary' : 'secondary'} title={d[0] + d.slice(1).toLowerCase()} icon={<I size={16} color={device === d ? '#fff' : c.text} />} onPress={() => setDevice(d)} style={{ flex: 1 }} />
          ))}</Row>
          <Label>Model</Label>
          <Row style={{ flexWrap: 'wrap' }}>{STITCH_MODELS.map((m) => <Chip key={m.id} label={`${m.label} · ${m.hint}`} active={model === m.id} onPress={() => setModel(m.id)} />)}</Row>
          <Label>Style</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{STYLES.map((s) => <Chip key={s} label={s} active={style === s} onPress={() => setStyle(style === s ? '' : s)} />)}</View>
        </Card>
        <ErrorBox error={err} />
        <Appear index={3}><Button title={mode === 'app' || activePlan?.isFullApp ? 'Generate full app' : 'Generate design'} icon={<Sparkles color="#fff" size={18} />} loading={busy} disabled={prompt.trim().length < 5} onPress={go} /></Appear>
        <Row style={{ justifyContent: 'center' }}><Coins size={14} color={c.amber} /><T muted size={12}>{costLabel} · refunded automatically if it fails</T></Row>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
