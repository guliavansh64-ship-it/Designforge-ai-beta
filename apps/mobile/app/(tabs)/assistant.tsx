import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Send, Bot, Eye, Info } from 'lucide-react-native';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useJob } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Job, Project } from '../../lib/types';
import { Button, Card, Chip, Empty, ErrorBox, Field, Row, T } from '../../components/ui';
import { JobCard } from '../../components/JobCard';
import { Animated, PressScale, TypingDots } from '../../components/motion';

/**
 * Assistant = chat with your design. Pick a project + screen, type a change in plain language and
 * Google Stitch edits that screen (saved as a new version you can restore). It also understands:
 *   "show me 3 variations" → Stitch variations · "add a settings page" → new screen in the same style
 *   "improve the design" → improvement engine · "convert this to React" → React code (free).
 */
interface Msg { id: string; role: 'user' | 'assistant'; text: string; code?: string; createdAt: number }
const SUGGEST = ['Make this design more premium', 'Change the colour theme to deep green', 'Add a testimonials section', 'Make the buttons bigger', 'Show me 3 variations', 'Add a settings page', 'Improve the design', 'Convert this to React'];
const ACTIVE = ['queued', 'running'];

export default function Assistant() {
  const c = useColors();
  const router = useRouter();
  const { me, refresh } = useAuth();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=30');
  const usable = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo' && p.pages.some((x) => x.currentVersionId));
  const [pid, setPid] = useState<string | null>(null);
  const project = usable.find((p) => p.id === pid) ?? usable[0];
  const pages = (project?.pages ?? []).filter((x) => x.currentVersionId);
  const [pgId, setPgId] = useState<string | null>(null);
  const page = pages.find((x) => x.id === pgId) ?? pages[0];
  const chat = useApi<{ messages: Msg[] }>(project ? `/projects/${project.id}/chat` : null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const job = useJob(jobId, () => { chat.reload(); projects.reload(); refresh(); });
  const list = useRef<any>(null);
  const stitchOn = !!me?.connections.find((x) => x.provider === 'stitch')?.connected;
  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: true }), 120); }, [chat.data?.messages.length]);
  useEffect(() => { setPgId(null); setJobId(null); }, [project?.id]);

  // Coming back to the tab: re-attach to a change that is still running for this project.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    api.get<{ jobs: Job[] }>(`/projects/${project.id}/jobs`).then((r) => {
      const running = r.jobs.find((j) => ACTIVE.includes(j.status));
      if (alive && running) setJobId(running.id);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [project?.id]);

  const send = async (msg = text) => {
    if (!project || !page || msg.trim().length < 2) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ job?: { id: string } }>(`/projects/${project.id}/chat`, { message: msg.trim(), pageId: page.id, idempotencyKey: newKey() });
      setText(''); if (r.job) setJobId(r.job.id); chat.reload();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  const lastUser = [...(chat.data?.messages ?? [])].reverse().find((m) => m.role === 'user');
  const working = busy || (job && ACTIVE.includes(job.status));

  if (!projects.loading && !usable.length) {
    return <Empty icon={<Bot size={32} color={c.primary} />} title="Chat with your designs" body="The Assistant edits your designs when you type changes like “make it dark” or “add a pricing section”. Generate a design in the Studio first." action={<Button title="Open Studio" onPress={() => router.push('/studio')} />} />;
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <View style={{ paddingTop: 10, gap: 6 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
          {usable.map((p) => <Chip key={p.id} label={p.name} active={p.id === project?.id} onPress={() => setPid(p.id)} />)}
        </ScrollView>
        {pages.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
            {pages.map((x) => <Chip key={x.id} label={`📱 ${x.name}`} active={x.id === page?.id} onPress={() => setPgId(x.id)} />)}
          </ScrollView>
        )}
      </View>
      <Animated.FlatList ref={list} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={9} data={chat.data?.messages ?? []} keyExtractor={(m: Msg) => m.id} contentContainerStyle={{ padding: 12, gap: 10 }}
        ListHeaderComponent={(help || !chat.data?.messages.length) ? (
          <Card style={{ gap: 6, marginBottom: 6 }}>
            <Row><Bot size={18} color={c.primary} /><T weight="700" style={{ flex: 1 }}>What the Assistant does</T></Row>
            <T muted size={13}>Type a change for the selected screen in plain words. Google Stitch edits the design and saves it as a new version (old versions can be restored from the project).</T>
            <T muted size={12}>• “Make it dark and premium” → edits the screen{'\n'}• “Show me 3 variations” → 3 alternatives{'\n'}• “Add a settings page” → new screen in the same style{'\n'}• “Improve the design” → automatic quality pass{'\n'}• “Convert this to React” → code (free)</T>
            <T muted size={11}>Edits use your Stitch account · {2} credits per change · refunded if it fails.</T>
          </Card>
        ) : null}
        ListFooterComponent={working ? <Animated.View entering={FadeIn} style={{ alignSelf: 'flex-start', backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}><TypingDots color={c.primary} /></Animated.View> : null}
        renderItem={({ item: m }: { item: Msg }) => (
          <Animated.View entering={(m.role === 'user' ? FadeInRight : FadeInLeft).springify().damping(18)} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', backgroundColor: m.role === 'user' ? c.primary : c.card, borderRadius: 16, padding: 12 }}>
            <T size={14} style={{ color: m.role === 'user' ? '#fff' : c.text }}>{m.text}</T>
            {m.code && <T size={11} style={{ fontFamily: 'monospace', marginTop: 8, color: c.muted }} numberOfLines={14}>{m.code}</T>}
          </Animated.View>
        )} />
      {job && (
        <View style={{ paddingHorizontal: 12, gap: 6 }}>
          <JobCard job={job} onDismiss={() => setJobId(null)} />
          {job.status === 'succeeded' && <Button small title="See the result" icon={<Eye size={15} color="#fff" />} onPress={() => router.push(`/preview/${project!.id}?page=${page?.id ?? ''}`)} />}
          {job.status === 'failed' && lastUser && <Button small variant="secondary" title="Try again" onPress={() => { setJobId(null); send(lastUser.text); }} />}
        </View>
      )}
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: c.border }}>
        <ErrorBox error={err} />
        {!stitchOn && me && <Button small variant="secondary" title="Connect Google Stitch to edit designs" onPress={() => router.push('/integrations')} />}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{SUGGEST.map((s) => <Chip key={s} label={s} onPress={() => setText(s)} />)}</ScrollView>
        <Row>
          <Field value={text} onChangeText={setText} placeholder={page ? `Change “${page.name}”…` : 'Select a project'} style={{ flex: 1 }} multiline maxLength={2000} />
          <PressScale onPress={() => send()} disabled={!!working || text.trim().length < 2} scaleTo={0.88} accessibilityLabel="Send" style={{ backgroundColor: c.primary, borderRadius: 14, padding: 13, opacity: working || text.trim().length < 2 ? 0.5 : 1 }}><Send color="#fff" size={20} /></PressScale>
        </Row>
        {project && (
          <Row style={{ justifyContent: 'space-between' }}>
            <PressScale onPress={() => router.push(`/project/${project.id}`)} scaleTo={0.97}><T size={12} style={{ color: c.primary }}>Open “{project.name}” →</T></PressScale>
            <PressScale onPress={() => setHelp((h) => !h)} scaleTo={0.9} accessibilityLabel="What can the assistant do?"><Info size={16} color={c.muted} /></PressScale>
          </Row>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
