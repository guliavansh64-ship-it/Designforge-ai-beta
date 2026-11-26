import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BellRing } from 'lucide-react-native';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, timeAgo } from '../lib/hooks';
import { useColors } from '../lib/theme';
import { showAlert } from '../components/Dialog';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';

type Audience = 'all' | 'plan' | 'user';
const PLANS = ['free', 'pro', 'premium', 'lifetime'] as const;
const LINKS = [['none', 'Notifications'], ['studio', 'Studio'], ['billing', 'Plans'], ['projects', 'Projects']] as const;

/** Admin-only: manual push to all users / a plan / one user. The server re-checks admin rights. */
export default function AdminPush() {
  const { me } = useAuth();
  const c = useColors();
  const hist = useApi<{ campaigns: { id: string; title: string; body: string; audience: string; planId?: string; user?: string; users: number; devices: number; createdAt: number }[] }>('/admin/push');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [planId, setPlanId] = useState<(typeof PLANS)[number]>('pro');
  const [user, setUser] = useState('');
  const [link, setLink] = useState<(typeof LINKS)[number][0]>('none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  if (!me?.user.isAdmin) return <View style={{ padding: 24 }}><T muted>Admins only.</T></View>;

  const doSend = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ users: number; devices: number; failed: number }>('/admin/push', { title, body, audience, planId: audience === 'plan' ? planId : undefined, user: audience === 'user' ? user.trim() : undefined, link });
      showAlert('Push sent ✅', `${r.users} user(s) · ${r.devices} device(s) reached${r.failed ? ` · ${r.failed} failed` : ''}`);
      setTitle(''); setBody(''); setUser(''); hist.reload();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  const send = () => audience === 'user' ? doSend() : showAlert('Send push?', `This goes to ${audience === 'all' ? 'ALL users' : `all ${planId} users`}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: doSend }]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <T muted size={12}>Automatic pushes (design ready, generation failed, payment success/failed, low credits, plan expiring) are sent by the server on their own. Use this to send your own message.</T>
      <ErrorBox error={err} />
      <Card style={{ gap: 10 }}>
        <Label>Title</Label><Field value={title} onChangeText={setTitle} placeholder="New templates are live 🎉" maxLength={120} />
        <Label>Message</Label><Field value={body} onChangeText={setBody} placeholder="Tap to try them in the Studio." maxLength={500} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Label>Send to</Label>
        <Row style={{ flexWrap: 'wrap' }}>{(['all', 'plan', 'user'] as const).map((a) => <Chip key={a} label={a === 'all' ? 'All users' : a === 'plan' ? 'A plan' : 'One user'} active={audience === a} onPress={() => setAudience(a)} />)}</Row>
        {audience === 'plan' && <Row style={{ flexWrap: 'wrap' }}>{PLANS.map((p) => <Chip key={p} label={p} active={planId === p} onPress={() => setPlanId(p)} />)}</Row>}
        {audience === 'user' && <Field value={user} onChangeText={setUser} placeholder="user@gmail.com or uid" autoCapitalize="none" keyboardType="email-address" />}
        <Label>Tap opens</Label>
        <Row style={{ flexWrap: 'wrap' }}>{LINKS.map(([id, l]) => <Chip key={id} label={l} active={link === id} onPress={() => setLink(id)} />)}</Row>
        <Button title="Send push" loading={busy} disabled={title.trim().length < 2 || body.trim().length < 2 || (audience === 'user' && !user.trim())} onPress={send} icon={<BellRing size={16} color="#fff" />} />
      </Card>
      <Label>Recent pushes</Label>
      {hist.data?.campaigns.map((h) => (
        <Card key={h.id} style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}><T weight="600" style={{ flex: 1 }}>{h.title}</T><Badge label={`${h.users} users`} tone="primary" /></Row>
          <T muted size={13}>{h.body}</T>
          <T muted size={11} style={{ color: c.muted }}>{h.audience === 'plan' ? `Plan: ${h.planId}` : h.audience === 'user' ? `User: ${h.user}` : 'All users'} · {h.devices} devices · {timeAgo(h.createdAt)}</T>
        </Card>
      ))}
      {!hist.data?.campaigns.length && <T muted size={13}>No pushes sent yet.</T>}
    </ScrollView>
  );
}
