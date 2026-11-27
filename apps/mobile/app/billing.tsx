import { useState } from 'react';
import { showAlert } from '../components/Dialog';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Check, Coins, History } from 'lucide-react-native';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, timeAgo } from '../lib/hooks';
import { paySubscription, razorpayMessage } from '../lib/razorpay';
import { purchase, type Purchase } from '../lib/checkout';
import { useColors } from '../lib/theme';
import type { Plan } from '../lib/types';
import { Badge, Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Appear, CountUp, PressScale, SkeletonList } from '../components/motion';

export default function Billing() {
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const plans = useApi<{ plans: Plan[]; packs: { id: string; credits: number; priceInr: number }[]; razorpayKeyId: string | null; paymentsProvider?: 'zetpay' | 'razorpay' | null; maxAmountInr?: number | null }>('/plans');
  const summary = useApi<{ transactions: { id: string; type: string; op?: string; reason?: string; amount: number; status: string; createdAt: number }[] }>('/billing/summary');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [autoRenew, setAutoRenew] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(false);
  const provider = plans.data?.paymentsProvider ?? (plans.data?.razorpayKeyId ? 'razorpay' : null);
  const zet = provider === 'zetpay';
  const tooHigh = (inr?: number) => !!(zet && plans.data?.maxAmountInr && (inr ?? 0) > plans.data.maxAmountInr);
  const run = async (id: string, p: Purchase, okMsg: string) => {
    setBusy(id); setErr(null);
    try {
      const r = await purchase(p, { prefill, onChecking: () => setChecking(true) });
      if (r.result === 'paid') await after(okMsg);
      else if (r.result === 'failed') showAlert('Payment failed', 'The UPI payment did not complete. If money was debited, your bank reverses it automatically.');
      else if (r.result === 'pending') showAlert('Payment pending', 'We are still waiting for confirmation from UPI. It will be added automatically and you will get a notification.');
      else if (r.message) showAlert('Payment not completed', r.message);
    } catch (e: any) { if (e instanceof ApiError) setErr(e); else showAlert('Payment not completed', razorpayMessage(e)); } finally { setBusy(null); setChecking(false); }
  };
  const prefill = { email: me?.user.email, name: me?.user.displayName ?? undefined };
  const after = async (msg: string) => { await Promise.all([refresh(), summary.reload()]); showAlert('Success', msg); };

  const buyPlan = async (p: Plan) => {
    const cyc = p.id === 'lifetime' ? 'one_time' : cycle;
    if (!zet && p.id !== 'lifetime' && autoRenew) {
      setBusy(p.id); setErr(null);
      try {
        const s = await api.post<{ subscriptionId: string; keyId: string }>('/billing/subscriptions', { planId: p.id, cycle });
        await paySubscription(s, `${p.name} (${cycle})`, prefill);
        await after('Payment received. Your plan activates in a few seconds.');
        setTimeout(refresh, 6000);
      } catch (e: any) { if (e instanceof ApiError) setErr(e); else showAlert('Payment not completed', razorpayMessage(e)); } finally { setBusy(null); }
      return;
    }
    await run(p.id, { kind: 'plan', planId: p.id, cycle: cyc }, `Welcome to ${p.name}! 🎉`);
  };
  const buyPack = (packId: string) => run(packId, { kind: 'pack', packId }, 'Credits added. 🎉');
  const redeem = async () => { setBusy('code'); try { const r = await api.post<{ credits: number }>('/billing/redeem', { code }); setCode(''); await after(`${r.credits} credits added.`); } catch (e) { setErr(e as ApiError); } finally { setBusy(null); } };
  const noPay = !provider || checking;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {/* Top-right corner: payment / transaction history. */}
      <Stack.Screen options={{ headerRight: () => (
        <PressScale onPress={() => router.push('/billing-history')} scaleTo={0.9} accessibilityLabel="Payment history"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: c.primary + '22', borderWidth: 1, borderColor: c.primary + '55' }}>
          <History size={16} color={c.primary} /><T size={13} weight="600" style={{ color: c.primary }}>History</T>
        </PressScale>
      ) }} />
      <Card index={0}><Row><Coins color={c.amber} size={26} /><View style={{ flex: 1 }}><CountUp value={me?.credits ?? 0} style={{ color: c.text, fontSize: 26, fontWeight: '800' }} /><T muted size={12}>Designo credits · {me?.plan.name} plan</T></View></Row>
        <T muted size={11} style={{ marginTop: 8 }}>Credits are separate from your Google Stitch/Gemini quota, which Google manages for your account.</T></Card>
      <ErrorBox error={err} />
      {!provider && plans.data && <T muted size={12}>Payments are temporarily unavailable. Please try again later.</T>}
      {checking && <Card><T size={13}>⏳ Confirming your UPI payment… please wait.</T></Card>}
      <Row><Chip label="Monthly" active={cycle === 'monthly'} onPress={() => setCycle('monthly')} /><Chip label="Annual (save ~20%)" active={cycle === 'annual'} onPress={() => setCycle('annual')} />{!zet && <Chip label={autoRenew ? 'Auto-renew ✓' : 'One-time'} active={autoRenew} onPress={() => setAutoRenew(!autoRenew)} />}</Row>
      {plans.loading && !plans.data && <SkeletonList rows={3} />}
      {plans.data?.plans.filter((p) => p.active && p.id !== 'free').map((p, pi) => {
        const price = p.id === 'lifetime' ? p.priceInrOneTime : cycle === 'annual' ? p.priceInrAnnual : p.priceInrMonthly;
        const cur = me?.plan.id === p.id;
        return (
          <Card key={p.id} index={pi + 1} style={{ gap: 8, borderColor: p.id === 'premium' ? c.primary : c.border }}>
            <Row style={{ justifyContent: 'space-between' }}><T weight="700" size={18}>{p.name}</T>{cur ? <Badge label="Current" tone="green" /> : p.id === 'premium' ? <Badge label="Popular" tone="primary" /> : null}</Row>
            <Row gap={2} style={{ alignItems: 'baseline' }}><T size={24} weight="800">₹</T><CountUp key={cycle} value={price ?? 0} style={{ color: c.text, fontSize: 24, fontWeight: '800' }} /><T muted size={13}>{p.id === 'lifetime' ? ' once' : cycle === 'annual' ? ' /year' : ' /month'}</T></Row>
            <T muted size={12}>{p.id === 'lifetime' ? `${p.oneTimeCredits} credits included` : `${cycle === 'annual' ? p.annualCredits : p.monthlyCredits} credits`} · {p.maxProjects} projects · {p.maxImproveIterations} improve iterations</T>
            {p.features.filter((f) => f !== 'pro_model').slice(0, 6).map((f) => <Row key={f}><Check size={14} color={c.green} /><T size={13}>{f.replace(/_/g, ' ')}</T></Row>)}
            <Button title={cur ? 'Current plan' : tooHigh(price) ? 'Not available via UPI' : `Get ${p.name}`} disabled={cur || noPay || tooHigh(price)} loading={busy === p.id} onPress={() => buyPlan(p)} />
          </Card>
        );
      })}
      <Label>Credit packs</Label>
      <Row style={{ flexWrap: 'wrap' }}>{plans.data?.packs.map((k, ki) => (
        <Card key={k.id} index={ki + 4} style={{ flexGrow: 1, minWidth: 100, gap: 6 }}><T weight="700" size={18}>{k.credits}</T><T muted size={12}>₹{k.priceInr}</T><Button small title="Buy" disabled={noPay} loading={busy === k.id} onPress={() => buyPack(k.id)} /></Card>
      ))}</Row>
      <Card index={7} style={{ gap: 8 }}><Label>Promo code</Label><Row><Field value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="WELCOME100" style={{ flex: 1 }} autoCapitalize="characters" /><Button small title="Redeem" loading={busy === 'code'} disabled={code.length < 3} onPress={redeem} /></Row></Card>
      {!zet && me?.subscription && me.plan.id !== 'free' && me.plan.id !== 'lifetime' && !me.subscription.cancelAtPeriodEnd && (
        <Button variant="ghost" title="Cancel auto-renew" onPress={() => showAlert('Cancel auto-renew?', 'You keep your plan until the end of the period, then move to Free.', [{ text: 'Keep plan', style: 'cancel' }, { text: 'Cancel auto-renew', style: 'destructive', onPress: async () => { await api.post('/billing/cancel').catch((e) => showAlert('Error', e.message)); refresh(); } }])} />
      )}
      <Button variant="secondary" title="View payment & credit history" icon={<History size={16} color={c.text} />} onPress={() => router.push('/billing-history')} />
      <T muted size={11}>{zet ? 'Secure UPI payments via ZetPay (GPay, PhonePe, Paytm, any UPI app). Plans are prepaid for 30 days / 1 year with no auto-debit — renew each period yourself (we’ll remind you when it expires). Credits and plans are granted only after our server confirms the payment.' : 'Payments processed by Razorpay. Your plan or credits are granted only after our server verifies the payment.'}</T>
    </ScrollView>
  );
}
