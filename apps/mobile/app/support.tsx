import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { api, ApiError } from '../lib/api';
import { useApi, timeAgo } from '../lib/hooks';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';

const FAQ = [
  ['Why my own Stitch account?', 'Stitch is a Google product with per-account quotas. Your generations use your quota and live in your Stitch account. We never use a shared key.'],
  ['Was I charged for a failed generation?', 'No — credits are reserved at start and refunded automatically on failure or cancel.'],
  ['Why does my key say invalid?', 'It may have been deleted or rotated, or your account has not opened Stitch yet. Visit stitch.withgoogle.com, then reconnect.'],
];

export default function Support() {
  const tickets = useApi<{ tickets: { id: string; subject: string; status: string; updatedAt: number; messages: { from: string; text: string }[] }[] }>('/tickets');
  const [subject, setSubject] = useState(''); const [type, setType] = useState('question'); const [message, setMessage] = useState('');
  const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setErr(null); try { await api.post('/tickets', { subject, type, message }); setSubject(''); setMessage(''); tickets.reload(); Alert.alert('Ticket created', 'We usually reply within 1 business day.'); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); } };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {FAQ.map(([q, a], i) => <Card key={q} index={i} style={{ gap: 4 }}><T weight="600">{q}</T><T muted size={13}>{a}</T></Card>)}
      <Card index={3} style={{ gap: 10 }}>
        <Label>New ticket</Label>
        <Field value={subject} onChangeText={setSubject} placeholder="Subject" maxLength={120} />
        <Row style={{ flexWrap: 'wrap' }}>{['question', 'bug', 'billing', 'feature', 'account'].map((t) => <Chip key={t} label={t} active={type === t} onPress={() => setType(t)} />)}</Row>
        <Field multiline value={message} onChangeText={setMessage} style={{ minHeight: 120 }} placeholder="Describe the issue. Never paste API keys." maxLength={5000} />
        <ErrorBox error={err} />
        <Button title="Submit" loading={busy} disabled={subject.length < 3 || message.length < 10} onPress={submit} />
      </Card>
      {tickets.data?.tickets.map((t, i) => (
        <Card key={t.id} index={4 + i} style={{ gap: 4 }}><Row style={{ justifyContent: 'space-between' }}><T weight="600" style={{ flex: 1 }}>{t.subject}</T><Badge label={t.status} tone={t.status === 'resolved' ? 'green' : 'amber'} /></Row>
          <T muted size={12}>{timeAgo(t.updatedAt)} · {t.messages.length} messages</T>{t.messages.slice(-1).map((m, i) => <T key={i} size={13}>{m.from === 'user' ? 'You' : 'Support'}: {m.text}</T>)}</Card>
      ))}
    </ScrollView>
  );
}
