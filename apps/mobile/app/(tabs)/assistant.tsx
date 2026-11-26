import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Send, Trash2, Lock } from 'lucide-react-native';
import { FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Badge, Chip, Row, T } from '../../components/ui';
import { Animated, PressScale, TypingDots } from '../../components/motion';
import { Logo } from '../../components/Logo';
import { showAlert } from '../../components/Dialog';

/**
 * Free, READ-ONLY assistant: ask questions about your projects, credits and plan.
 * It never changes a project and never spends credits (server: POST /api/assistant/ask).
 */
interface Msg { id: string; role: 'user' | 'assistant'; text: string; createdAt: number; pending?: boolean }
const Q_PROJECT = ['How many pages does it have?', 'Which colours and fonts are used?', 'What can I export?'];
const Q_GENERAL = ['How many credits do I have?', 'When does my plan end?', 'How do I create an app?'];

export default function Assistant() {
  const c = useColors();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=20');
  const [projectId, setProjectId] = useState<string>('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const list = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo');
  const project = list.find((p) => p.id === projectId);

  useFocusEffect(useCallback(() => { projects.reload(); /* eslint-disable-next-line */ }, []));
  // Default to the most recent project.
  useEffect(() => { if (!projectId && list[0]) setProjectId(list[0].id); /* eslint-disable-next-line */ }, [list.length]);
  useEffect(() => {
    let alive = true;
    api.get<{ messages: Msg[] }>(`/assistant/messages${projectId ? `?projectId=${projectId}` : ''}`).then((r) => { if (alive) setMsgs(r.messages); }).catch(() => { if (alive) setMsgs([]); });
    return () => { alive = false; };
  }, [projectId]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [msgs.length]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    Haptics.selectionAsync().catch(() => undefined);
    setText(''); setBusy(true);
    const tmp: Msg = { id: `tmp${Date.now()}`, role: 'user', text: question, createdAt: Date.now() };
    setMsgs((m) => [...m, tmp, { id: 'typing', role: 'assistant', text: '', createdAt: Date.now(), pending: true }]);
    try {
      const r = await api.post<{ question: Msg; answer: Msg }>('/assistant/ask', { question, ...(projectId && { projectId }) });
      setMsgs((m) => [...m.filter((x) => x.id !== tmp.id && x.id !== 'typing'), r.question, r.answer]);
    } catch (e) {
      const msg = (e as ApiError).message || 'Could not reach the server. Try again.';
      setMsgs((m) => [...m.filter((x) => x.id !== 'typing'), { id: `err${Date.now()}`, role: 'assistant', text: `⚠️ ${msg}`, createdAt: Date.now() }]);
    } finally { setBusy(false); }
  };
  const clear = () => showAlert('Clear this chat?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: async () => { await api.del(`/assistant/messages${projectId ? `?projectId=${projectId}` : ''}`).catch(() => undefined); setMsgs([]); } }]);
  const suggestions = projectId ? Q_PROJECT : Q_GENERAL;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Context picker */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6}><Badge label="Free" tone="green" /><Lock size={12} color={c.muted} /><T muted size={12}>Answers only · never changes your project</T></Row>
          {msgs.length > 0 && <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Clear chat"><Trash2 size={18} color={c.muted} /></Pressable>}
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
          {list.map((p) => <Chip key={p.id} label={p.name} active={p.id === projectId} onPress={() => setProjectId(p.id)} />)}
          <Chip label="General" active={!projectId} onPress={() => setProjectId('')} />
        </ScrollView>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {msgs.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 20 }}>
            <Animated.View entering={ZoomIn.springify().damping(14)}><Logo size={72} /></Animated.View>
            <Animated.View entering={FadeInDown.delay(100)} style={{ alignItems: 'center', gap: 4 }}>
              <T size={18} weight="800">Ask me anything</T>
              <T muted size={13} style={{ textAlign: 'center' }}>{project ? `About “${project.name}” — pages, colours, fonts, status, exports.` : 'About your credits, plan, or how DesignForge works.'}</T>
            </Animated.View>
            <View style={{ gap: 8, alignSelf: 'stretch' }}>
              {suggestions.map((s, i) => (
                <Animated.View key={s} entering={FadeInUp.delay(200 + i * 90).springify().damping(15)}>
                  <PressScale onPress={() => ask(s)} style={{ borderWidth: 1, borderColor: c.primary + '55', backgroundColor: c.primary + '14', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 }}>
                    <T size={14}>{s}</T>
                  </PressScale>
                </Animated.View>
              ))}
            </View>
          </View>
        ) : msgs.map((m) => (
          <Animated.View key={m.id} entering={(m.role === 'user' ? FadeInUp : FadeInDown).springify().damping(16)}
            style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%' }}>
            <View style={{ backgroundColor: m.role === 'user' ? c.primary : c.card, borderRadius: 20, borderBottomRightRadius: m.role === 'user' ? 6 : 20, borderBottomLeftRadius: m.role === 'user' ? 20 : 6, paddingVertical: 10, paddingHorizontal: 14, borderWidth: m.role === 'user' ? 0 : 1, borderColor: c.border }}>
              {m.pending ? <TypingDots color={c.primary} /> : <T size={14} style={{ color: m.role === 'user' ? '#fff' : c.text }}>{m.text}</T>}
            </View>
          </Animated.View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg, alignItems: 'flex-end' }}>
        <TextInput value={text} onChangeText={setText} placeholder={project ? `Ask about “${project.name}”…` : 'Ask a question…'} placeholderTextColor={c.muted} multiline maxLength={1500}
          style={{ flex: 1, minHeight: 46, maxHeight: 120, backgroundColor: c.card, borderRadius: 23, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, borderWidth: 1, borderColor: c.border }}
          onSubmitEditing={() => ask(text)} accessibilityLabel="Ask the assistant" />
        <PressScale onPress={() => ask(text)} disabled={!text.trim() || busy} scaleTo={0.85} accessibilityLabel="Send"
          style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: text.trim() && !busy ? c.primary : c.card2, alignItems: 'center', justifyContent: 'center' }}>
          <Send size={19} color={text.trim() && !busy ? '#fff' : c.muted} />
        </PressScale>
      </View>
    </KeyboardAvoidingView>
  );
}
