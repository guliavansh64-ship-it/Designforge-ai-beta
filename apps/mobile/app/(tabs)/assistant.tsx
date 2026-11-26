import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Send, Bot } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useApi, useJob } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Button, Chip, Empty, ErrorBox, Field, Row, T } from '../../components/ui';
import { JobCard } from '../../components/JobCard';
import { Animated, PressScale, TypingDots } from '../../components/motion';

interface Msg { id: string; role: 'user' | 'assistant'; text: string; code?: string; createdAt: number }
const SUGGEST = ['Make this design more premium', 'Improve the mobile layout', 'Change the colour theme to deep green', 'Add a testimonials section', 'Show me 3 variations', 'Convert this to React'];

export default function Assistant() {
  const c = useColors();
  const router = useRouter();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=30');
  const usable = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo' && p.pages.some((x) => x.currentVersionId));
  const [pid, setPid] = useState<string | null>(null);
  const project = usable.find((p) => p.id === pid) ?? usable[0];
  const page = project?.pages.find((x) => x.currentVersionId);
  const chat = useApi<{ messages: Msg[] }>(project ? `/projects/${project.id}/chat` : null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, () => chat.reload());
  const list = useRef<any>(null);
  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: true }), 100); }, [chat.data?.messages.length]);

  const send = async () => {
    if (!project || !page || text.trim().length < 2) return;
    setBusy(true); setErr(null);
    try { const r = await api.post<{ job?: { id: string } }>(`/projects/${project.id}/chat`, { message: text, pageId: page.id, idempotencyKey: newKey() }); setText(''); if (r.job) setJobId(r.job.id); chat.reload(); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  if (!projects.loading && !usable.length) return <Empty icon={<Bot size={32} color={c.primary} />} title="No designs yet" body="Generate a design first — then chat to refine it." action={<Button title="Open Studio" onPress={() => router.push('/studio')} />} />;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 6 }}>
        {usable.map((p) => <Chip key={p.id} label={p.name} active={p.id === project?.id} onPress={() => setPid(p.id)} />)}
      </ScrollView>
      <Animated.FlatList ref={list} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={9} data={chat.data?.messages ?? []} keyExtractor={(m: Msg) => m.id} contentContainerStyle={{ padding: 12, gap: 10 }}
        ListFooterComponent={busy || (job && !['succeeded', 'failed', 'cancelled'].includes(job.status)) ? <Animated.View entering={FadeIn} style={{ alignSelf: 'flex-start', backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}><TypingDots color={c.primary} /></Animated.View> : null}
        ListEmptyComponent={<T muted size={13}>Ask for changes in plain language. Each edit becomes a new version you can restore.</T>}
        renderItem={({ item: m }: { item: Msg }) => (
          <Animated.View entering={(m.role === 'user' ? FadeInRight : FadeInLeft).springify().damping(18)} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', backgroundColor: m.role === 'user' ? c.primary : c.card, borderRadius: 16, padding: 12 }}>
            <T size={14} style={{ color: m.role === 'user' ? '#fff' : c.text }}>{m.text}</T>
            {m.code && <T size={11} style={{ fontFamily: 'monospace', marginTop: 8, color: c.muted }} numberOfLines={14}>{m.code}</T>}
          </Animated.View>
        )} />
      {job && <View style={{ paddingHorizontal: 12 }}><JobCard job={job} onDismiss={() => setJobId(null)} /></View>}
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: c.border }}>
        <ErrorBox error={err} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{SUGGEST.map((s) => <Chip key={s} label={s} onPress={() => setText(s)} />)}</ScrollView>
        <Row>
          <Field value={text} onChangeText={setText} placeholder={project ? `Change “${page?.name}”…` : 'Select a project'} style={{ flex: 1 }} multiline />
          <PressScale onPress={send} disabled={busy || text.trim().length < 2} scaleTo={0.88} accessibilityLabel="Send" style={{ backgroundColor: c.primary, borderRadius: 14, padding: 13, opacity: busy || text.trim().length < 2 ? 0.5 : 1 }}><Send color="#fff" size={20} /></PressScale>
        </Row>
        {project && <PressScale onPress={() => router.push(`/project/${project.id}`)} scaleTo={0.97}><T size={12} style={{ color: c.primary }}>Open “{project.name}” preview →</T></PressScale>}
      </View>
    </KeyboardAvoidingView>
  );
}
