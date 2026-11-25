import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Check, Coins } from 'lucide-react-native';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, timeAgo } from '../lib/hooks';
import { payOrder, paySubscription, razorpayMessage } from '../lib/razorpay';
import { useColors } from '../lib/theme';
import type { Plan } from '../lib/types';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Appear, CountUp, SkeletonList } from '../components/motion';

export default function Billing() {
  const { me, refresh } = useAuth();
  const c = useColors();
  const plans = useApi<{ plans: Plan[]; packs: { id: string; credits: number; priceInr: number }[]; razorpayKeyId: string | null }>('/plans');
  const summary = useApi<{ transactions: { id: string; type: string; op?: string; reason?: string; amount: number; status: string; createdAt: number }[] }>('/billing/summary');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [autoRenew, setAutoRenew] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const prefill = { email: me?.user.email, name: me?.user.displayName ?? undefined };
  const after = async (msg: string) => { await Promise.all([refresh(), summary.reload()]); Alert.alert('Success', msg); };

  const buyPlan = async (p: Plan) => {
    setBusy(p.id); setErr(null);
    try {
      if (p.id !== 'lifetime' && autoRenew) {
        const s = await api.post<{ subscriptionId: string; keyId: string }>('/billing/subscriptions', { planId: p.id, cycle });
        await paySubscription(s, `${p.name} (${cycle})`, prefill);
        await after('Payment received. Your plan activates as soon as Razorpay confirms (usually seconds).');
        setTimeout(refresh, 6000);
      } else {
        const o = await api.post<{ orderId: string; amount: number; keyId: string; description: string }>('/billing/orders', { purchase: { kind: 'plan', planId: p.id, cycle: p.id === 'lifetime' ? 'one_time' : cycle } });
        await payOrder(o, prefill); await after(`Welcome to ${p.name}!`);
      }
    } catch (e: any) { if (e instanceof ApiError) setErr(e); else Alert.alert('Payment not completed', razorpayMessage(e)); } finally { setBusy(null); }
  };
  const buyPack = async (packId: string) => {
    setBusy(packId); setErr(null);
    try { const o = await api.post<{ orderId: string; amount: number; keyId: string; description: string }>('/billing/orders', { purchase: { kind: 'pack', packId } }); await payOrder(o, prefill); await after('Credits added.'); }
    catch (e: any) { if (e instanceof ApiError) setErr(e); else Alert.alert('Payment not completed', razorpayMessage(e)); } finally { setBusy(null); }
  };
  const redeem = async () => { setBusy('code'); try { const r = await api.post<{ credits: number }>('/billing/redeem', { code }); setCode(''); await after(`${r.credits} credits added.`); } catch (e) { setErr(e as ApiError); } finally { setBusy(null); } };
  const noPay = !plans.data?.razorpayKeyId;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card index={0}><Row><Coins color={c.amber} size={26} /><View style={{ flex: 1 }}><CountUp value={me?.credits ?? 0} style={{ color: c.text, fontSize: 26, fontWeight: '800' }} /><T muted size={12}>DesignForge credits · {me?.plan.name} plan</T></View></Row>
        <T muted size={11} style={{ marginTop: 8 }}>Credits are separate from your Google Stitch/Gemini quota, which Google manages for your account.</T></Card>
      <ErrorBox error={err} />
      {noPay && plans.data && <T muted size={12}>Payments aren't configured on this server yet.</T>}
      <Row><Chip label="Monthly" active={cycle === 'monthly'} onPress={() => setCycle('monthly')} /><Chip label="Annual (save ~20%)" active={cycle === 'annual'} onPress={() => setCycle('annual')} /><Chip label={autoRenew ? 'Auto-renew ✓' : 'One-time'} active={autoRenew} onPress={() => setAutoRenew(!autoRenew)} /></Row>
      {plans.loading && !plans.data && <SkeletonList rows={3} />}
      {plans.data?.plans.filter((p) => p.active && p.id !== 'free').map((p, pi) => {
        const price = p.id === 'lifetime' ? p.priceInrOneTime : cycle === 'annual' ? p.priceInrAnnual : p.priceInrMonthly;
        const cur = me?.plan.id === p.id;
        return (
          <Card key={p.id} index={pi + 1} style={{ gap: 8, borderColor: p.id === 'premium' ? c.primary : c.border }}>
            <Row style={{ justifyContent: 'space-between' }}><T weight="700" size={18}>{p.name}</T>{cur ? <Badge label="Current" tone="green" /> : p.id === 'premium' ? <Badge label="Popular" tone="primary" /> : null}</Row>
            <Row gap={2} style={{ alignItems: 'baseline' }}><T size={24} weight="800">₹</T><CountUp key={cycle} value={price ?? 0} style={{ color: c.text, fontSize: 24, fontWeight: '800' }} /><T muted size={13}>{p.id === 'lifetime' ? ' once' : cycle === 'annual' ? ' /year' : ' /month'}</T></Row>
            <T muted size={12}>{p.id === 'lifetime' ? `${p.oneTimeCredits} credits included` : `${cycle === 'annual' ? p.annualCredits : p.monthlyCredits} credits`} · {p.maxProjects} projects · {p.maxImproveIterations} improve iterations</T>
            {p.features.slice(0, 6).map((f) => <Row key={f}><Check size={14} color={c.green} /><T size={13}>{f.replace(/_/g, ' ')}</T></Row>)}
            <Button title={cur ? 'Current plan' : `Get ${p.name}`} disabled={cur || noPay} loading={busy === p.id} onPress={() => buyPlan(p)} />
          </Card>
        );
      })}
      <Label>Credit packs</Label>
      <Row style={{ flexWrap: 'wrap' }}>{plans.data?.packs.map((k, ki) => (
        <Card key={k.id} index={ki + 4} style={{ flexGrow: 1, minWidth: 100, gap: 6 }}><T weight="700" size={18}>{k.credits}</T><T muted size={12}>₹{k.priceInr}</T><Button small title="Buy" disabled={noPay} loading={busy === k.id} onPress={() => buyPack(k.id)} /></Card>
      ))}</Row>
      <Card index={7} style={{ gap: 8 }}><Label>Promo code</Label><Row><Field value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="WELCOME100" style={{ flex: 1 }} autoCapitalize="characters" /><Button small title="Redeem" loading={busy === 'code'} disabled={code.length < 3} onPress={redeem} /></Row></Card>
      {me?.subscription && me.plan.id !== 'free' && me.plan.id !== 'lifetime' && !me.subscription.cancelAtPeriodEnd && (
        <Button variant="ghost" title="Cancel auto-renew" onPress={() => Alert.alert('Cancel auto-renew?', 'You keep your plan until the end of the period, then move to Free.', [{ text: 'Keep plan', style: 'cancel' }, { text: 'Cancel auto-renew', style: 'destructive', onPress: async () => { await api.post('/billing/cancel').catch((e) => Alert.alert('Error', e.message)); refresh(); } }])} />
      )}
      <Label>Recent transactions</Label>
      <Card index={8} style={{ gap: 8 }}>{summary.data?.transactions.slice(0, 15).map((t, ti) => (
        <Appear key={t.id} index={ti}><Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><T size={13}>{t.op ?? t.reason ?? t.type}</T><T muted size={11}>{timeAgo(t.createdAt)}{t.status === 'refunded' ? ' · refunded' : ''}</T></View><T size={13} style={{ color: t.type === 'debit' && t.status !== 'refunded' ? c.ember : c.green }}>{t.type === 'debit' ? '−' : '+'}{Math.abs(t.amount)}</T></Row></Appear>
      ))}{!summary.data?.transactions.length && <T muted size={13}>No transactions yet.</T>}</Card>
      <T muted size={11}>Payments processed by Razorpay (UPI, cards, netbanking, wallets). Your plan or credits are granted only after our server verifies the payment signature.</T>
    </ScrollView>
  );
}
