import { useState } from 'react';
import { showAlert, toast } from '../components/Dialog';
import { Linking, ScrollView, Switch, View } from 'react-native';
import { CheckCircle2, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react-native';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/hooks';
import { useColors } from '../lib/theme';
import { Badge, Button, Card, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Animated, popIn } from '../components/motion';
import { FadeInDown } from 'react-native-reanimated';

const P = {
  stitch: { name: 'Google Stitch', role: 'Generates UI screens, websites & Logo Studio concepts in your own Stitch account.', url: 'https://stitch.withgoogle.com/settings', steps: '1. Open stitch.withgoogle.com and sign in\n2. Settings → API keys → Create key\n3. Copy it and paste below' },
  gemini: { name: 'Gemini', role: 'Makes short ideas smarter and powers the Assistant.', url: 'https://aistudio.google.com/app/apikey', steps: '1. Open Google AI Studio\n2. Create API key\n3. Copy it and paste below' },
} as const;

export default function Integrations() {
  const { me, refresh } = useAuth();
  const c = useColors();
  const [open, setOpen] = useState<'stitch' | 'gemini' | null>(null);
  const [key, setKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const connect = async () => {
    if (!open) return; setBusy('c'); setErr(null);
    try { await api.post(`/connections/${open}`, { apiKey: key.trim() }); const name = P[open].name; setKey(''); setOpen(null); setConsent(false); refresh(); toast(`${name} connected · key verified & encrypted`); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const disconnect = (p: 'stitch' | 'gemini') => showAlert(`Disconnect ${P[p].name}?`, 'The encrypted key is deleted from Designo immediately.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: async () => {
    try { const r = await api.del<{ revokeUrl: string }>(`/connections/${p}`); refresh(); showAlert('Disconnected', 'For full safety, also delete the key at the source.', [{ text: 'Done' }, { text: 'Revoke at source', onPress: () => Linking.openURL(r.revokeUrl) }]); } catch (e) { showAlert('Error', (e as Error).message); }
  } }]);
  const verify = async (p: string) => { setBusy('v' + p); try { const r = await api.post<{ ok: boolean }>(`/connections/${p}/verify`); refresh(); showAlert(r.ok ? 'Verified' : 'Verification failed', r.ok ? 'Connection works.' : 'See the status for details.'); } catch (e) { showAlert('Error', (e as Error).message); } finally { setBusy(null); } };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card index={0} style={{ borderColor: c.green + '55' }}><Row style={{ alignItems: 'flex-start' }}><ShieldCheck color={c.green} size={20} /><T size={13} muted style={{ flex: 1 }}>Signing in with Google does not give Designo Stitch access — this is a separate, explicit step. Keys are encrypted (AES-256-GCM) on our server, never stored in this app, never shared, and only the last 4 characters are shown. No shared/admin key is ever used for your requests.</T></Row></Card>
      {(Object.keys(P) as ('stitch' | 'gemini')[]).map((p, pi) => {
        const conn = me?.connections.find((x) => x.provider === p);
        return (
          <Card key={p} index={pi + 1} style={{ gap: 10 }}>
            <Row><Animated.View key={String(conn?.connected)} entering={popIn}>{conn?.connected ? <CheckCircle2 color={c.green} size={20} /> : <AlertTriangle color={c.amber} size={20} />}</Animated.View><T weight="700" style={{ flex: 1 }}>{P[p].name}</T><Badge label={conn?.status?.replace('_', ' ') ?? 'not connected'} tone={conn?.connected ? 'green' : conn?.status === 'not_connected' ? 'neutral' : 'amber'} /></Row>
            <T muted size={13}>{P[p].role}</T>
            {conn && conn.status !== 'not_connected' && <T size={13}>Key ••••{conn.keyHint?.replace('…', '')} · verified {timeAgo(conn.lastVerifiedAt)}</T>}
            {conn?.lastError && <T size={12} style={{ color: c.amber }}>{conn.lastError}</T>}
            {open === p ? (
              <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: 10 }}>
                <T muted size={13}>{P[p].steps}</T>
                <Button small variant="ghost" title="Open key page" icon={<ExternalLink size={14} color={c.text} />} onPress={() => Linking.openURL(P[p].url)} />
                <Label>API key</Label>
                <Field value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste key" importantForAutofill="no" />
                <Row style={{ alignItems: 'flex-start' }}><Switch value={consent} onValueChange={setConsent} trackColor={{ true: c.primary }} /><T size={12} muted style={{ flex: 1 }}>I authorize Designo to store this key encrypted and use it only for requests I make. I can disconnect any time.</T></Row>
                <ErrorBox error={err} />
                <Row><Button style={{ flex: 1 }} variant="secondary" title="Cancel" onPress={() => { setOpen(null); setKey(''); }} /><Button style={{ flex: 1 }} title="Verify & connect" loading={busy === 'c'} disabled={key.trim().length < 20 || !consent} onPress={connect} /></Row>
              </Animated.View>
            ) : conn?.status && conn.status !== 'not_connected' ? (
              <Row><Button small variant="secondary" title="Re-verify" loading={busy === 'v' + p} onPress={() => verify(p)} /><Button small variant="secondary" title="Replace" onPress={() => { setOpen(p); setErr(null); }} /><Button small variant="ghost" title="Disconnect" onPress={() => disconnect(p)} /></Row>
            ) : <Button title="Connect" onPress={() => { setOpen(p); setErr(null); }} />}
          </Card>
        );
      })}
    </ScrollView>
  );
}
