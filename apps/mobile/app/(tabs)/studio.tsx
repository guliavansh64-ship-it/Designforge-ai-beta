import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Sparkles, Smartphone, Tablet, Monitor, Coins } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../../components/ui';
import { Appear, Swap } from '../../components/motion';

const STYLES = ['Clean & minimal', 'Bold & vibrant', 'Dark & premium', 'Playful', 'Corporate', 'Editorial'];
const IDEAS = { ui: ['Fintech home screen with balance card, quick actions and recent transactions', 'Habit tracker onboarding screen with 3 benefits and a Get started button'], website: ['Website for an Ayurvedic clinic in Jaipur: services, doctors, testimonials, booking CTA', 'Landing page for a B2B invoicing SaaS with pricing and FAQ'] };

export default function Studio() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [kind, setKind] = useState<'ui' | 'website'>(params.kind === 'website' ? 'website' : 'ui');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>(params.kind === 'website' ? 'DESKTOP' : 'MOBILE');
  const [model, setModel] = useState<'GEMINI_3_FLASH' | 'GEMINI_3_1_PRO'>('GEMINI_3_FLASH');
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const hasPro = me?.plan.features.includes('pro_model');

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const { project } = await api.post<{ project: Project }>('/projects', { name: name.trim() || prompt.split(/[.,\n]/)[0].slice(0, 60) || 'Untitled', kind, deviceType: device });
      const { job } = await api.post<{ job: { id: string } }>(`/projects/${project.id}/generate`, { prompt, deviceType: device, model, pageId: project.pages[0].id, style: style || undefined, idempotencyKey: newKey() });
      refresh(); setPrompt(''); setName('');
      router.push(`/project/${project.id}?job=${job.id}`);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Appear><Row><Chip label="App UI" active={kind === 'ui'} onPress={() => { setKind('ui'); setDevice('MOBILE'); }} /><Chip label="Website" active={kind === 'website'} onPress={() => { setKind('website'); setDevice('DESKTOP'); }} /></Row></Appear>
        {kind === 'website' && !me?.plan.features.includes('website_studio') && <ErrorBox error={Object.assign(new Error('Website Studio is available on Pro and above.'), { action: 'upgrade_plan' }) as any} />}
        <Card index={1} style={{ gap: 12 }}>
          <View><Label>Project name</Label><Field value={name} onChangeText={setName} placeholder={kind === 'website' ? 'Ember & Oak Café' : 'Pulse fintech app'} maxLength={80} /></View>
          <View><Label>{kind === 'website' ? 'Business brief' : 'Describe the screen'}</Label>
            <Field multiline value={prompt} onChangeText={setPrompt} maxLength={4000} style={{ minHeight: 140 }} placeholder="Content, audience and the main action…" />
            <T muted size={11} style={{ textAlign: 'right', marginTop: 4 }}>{prompt.length}/4000</T></View>
          <Swap id={kind} style={{ gap: 6 }}>{IDEAS[kind].map((i) => <Chip key={i} label={i.length > 52 ? i.slice(0, 52) + '…' : i} onPress={() => setPrompt(i)} />)}</Swap>
        </Card>
        <Card index={2} style={{ gap: 12 }}>
          <Label>Device</Label>
          <Row>{([['MOBILE', Smartphone], ['TABLET', Tablet], ['DESKTOP', Monitor]] as const).map(([d, I]) => (
            <Button key={d} small variant={device === d ? 'primary' : 'secondary'} title={d[0] + d.slice(1).toLowerCase()} icon={<I size={16} color={device === d ? '#fff' : c.text} />} onPress={() => setDevice(d)} style={{ flex: 1 }} />
          ))}</Row>
          <Label>Model</Label>
          <Row><Chip label="Gemini 3 Flash · 2 cr" active={model === 'GEMINI_3_FLASH'} onPress={() => setModel('GEMINI_3_FLASH')} /><Chip label={`3.1 Pro · 5 cr${hasPro ? '' : ' 🔒'}`} active={model === 'GEMINI_3_1_PRO'} onPress={() => hasPro ? setModel('GEMINI_3_1_PRO') : router.push('/billing')} /></Row>
          <Label>Style</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{STYLES.map((s) => <Chip key={s} label={s} active={style === s} onPress={() => setStyle(style === s ? '' : s)} />)}</View>
        </Card>
        <ErrorBox error={err} />
        <Appear index={3}><Button title="Generate design" icon={<Sparkles color="#fff" size={18} />} loading={busy} disabled={prompt.trim().length < 5} onPress={go} /></Appear>
        <Row style={{ justifyContent: 'center' }}><Coins size={14} color={c.amber} /><T muted size={12}>{model === 'GEMINI_3_1_PRO' ? 5 : 2} credits · refunded automatically if it fails</T></Row>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
