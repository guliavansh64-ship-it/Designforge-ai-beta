import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Coins, Gift, ArrowDownRight, ArrowUpRight, RotateCcw } from 'lucide-react';
import { CREDIT_COSTS } from '@designforge/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, timeAgo } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { startPurchase, waitForZetpay, type PlansInfo } from '../lib/checkout';
import { Badge, BarChart, Button, Card, ErrorBox, PageHeader } from '../components/ui';

interface Txn { id: string; type: 'debit' | 'grant' | 'refund' | 'adjust'; op?: string; amount: number; status: string; reason?: string; createdAt: number }
interface Plans extends PlansInfo { packs: { id: string; credits: number; priceInr: number }[] }
const OP_LABEL: Record<string, string> = { generate_flash: 'Generate (Flash)', generate_pro: 'Generate (Pro)', edit: 'AI edit', variants: 'Variations', improve_iteration: 'Improve iteration', logo_batch: 'Logo concepts', html_export: 'HTML export', react_export: 'React export', chat_edit: 'Chat edit' };

export default function Credits() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const summary = useApi<{ credits: number; transactions: Txn[] }>('/billing/summary');
  const usage = useApi<{ usage: { day: string; credits: number }[] }>('/billing/usage');
  const plans = useApi<Plans>('/plans');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const [params, setParams] = useSearchParams();
  const [checking, setChecking] = useState(false);
  // Back from the ZetPay page (/credits?zp_order=…): confirm via our server, never trust the URL.
  useEffect(() => {
    const id = params.get('zp_order') || sessionStorage.getItem('df_pending_order');
    if (!id) return;
    sessionStorage.removeItem('df_pending_order');
    setParams({}, { replace: true });
    setChecking(true);
    waitForZetpay(id).then(async (s) => {
      if (s === 'paid') { toast('success', 'Payment successful — your purchase is active.'); await Promise.all([refresh(), summary.reload()]); }
      else if (s === 'failed') toast('error', 'Payment failed. If money was debited, your bank will reverse it automatically.');
      else toast('info', 'Payment is still pending. It will be added automatically once confirmed — you will get a notification.');
    }).finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (packId: string) => {
    setBusy(packId); setErr(null);
    try {
      await startPurchase({ kind: 'pack', packId }, {
        email: me?.user.email, name: me?.user.displayName ?? undefined,
        onPaid: async () => { toast('success', 'Payment verified — credits added.'); await Promise.all([refresh(), summary.reload()]); },
        onError: (m) => toast('error', m), onDismiss: () => setBusy(null),
      });
    } catch (e) { setErr(e as ApiError); setBusy(null); }
  };
  const redeem = async () => {
    setBusy('code'); setErr(null);
    try { const r = await api.post<{ credits: number }>('/billing/redeem', { code }); toast('success', `${r.credits} credits added.`); setCode(''); await Promise.all([refresh(), summary.reload()]); }
    catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const icon = (t: Txn) => t.status === 'refunded' || t.type === 'refund' ? <RotateCcw className="h-4 w-4 text-sky-500" /> : t.type === 'debit' ? <ArrowDownRight className="h-4 w-4 text-ember-500" /> : <ArrowUpRight className="h-4 w-4 text-emerald-500" />;

  return (
    <div>
      <PageHeader title="Credits & Usage" subtitle="Designo credits pay for platform features. Your Google Stitch / Gemini quota is separate and managed by Google for your account." />
      <ErrorBox error={err} className="mb-5" />
      {checking && <Card className="mb-5 p-4 text-sm">⏳ Confirming your UPI payment with ZetPay… keep this page open.</Card>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-gradient-to-br from-forge-500/15 to-ember-500/10 p-6">
          <p className="text-sm muted">Balance</p>
          <p className="mt-1 flex items-center gap-2 font-display text-5xl font-semibold"><Coins className="h-8 w-8 text-amber-500" />{me?.credits ?? 0}</p>
          <p className="muted mt-2 text-xs">{me?.plan.name} plan · {me?.plan.monthlyCredits ? `${me.plan.monthlyCredits} credits each billing month` : me?.plan.oneTimeCredits ? 'one-time allowance + packs' : ''}</p>
          <div className="mt-6"><span className="label">Promo / credit code</span><div className="flex gap-2"><input className="field" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME100" maxLength={40} /><Button variant="secondary" loading={busy === 'code'} disabled={code.length < 3} onClick={redeem} icon={<Gift className="h-4 w-4" />}>Redeem</Button></div></div>
        </Card>
        <Card className="p-6 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-display font-semibold">Last 30 days</h2><span className="muted text-xs">{(usage.data?.usage ?? []).reduce((s, d) => s + d.credits, 0)} credits used</span></div>
          {usage.data && <BarChart height={150} data={usage.data.usage.map((d) => ({ label: d.day, value: d.credits }))} format={(n) => `${n} credits`} />}
          <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-5">{Object.entries(CREDIT_COSTS).map(([k, v]) => <div key={k} className="surface-2 rounded-lg px-2 py-1.5"><p className="muted truncate">{OP_LABEL[k]}</p><p className="font-semibold">{v} cr</p></div>)}</div>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Buy credit packs</h2>
      <div className="grid gap-4 sm:grid-cols-3">{plans.data?.packs.map((p, i) => (
        <Card key={p.id} className="relative p-5">
          {i === 1 && <Badge tone="forge" className="absolute right-4 top-4">Best value</Badge>}
          <p className="font-display text-3xl font-semibold">{p.credits.toLocaleString('en-IN')}</p><p className="muted text-xs">credits · never expire while your account is active</p>
          <p className="mt-4 text-xl font-semibold">₹{p.priceInr.toLocaleString('en-IN')} <span className="muted text-xs font-normal">incl. taxes as applicable</span></p>
          <Button className="mt-4 w-full" loading={busy === p.id} disabled={!plans.data?.paymentsProvider || checking} onClick={() => buy(p.id)}>Buy with UPI</Button>
        </Card>
      ))}</div>
      {plans.data && !plans.data.paymentsProvider && <p className="muted mt-2 text-xs">Payments are temporarily unavailable. Please try again later.</p>}
      {plans.data?.paymentsProvider === 'zetpay' && <p className="muted mt-2 text-xs">Secure UPI payment via ZetPay (GPay, PhonePe, Paytm, any UPI app). Credits are added the moment the payment is confirmed.</p>}

      <Card className="mt-8 overflow-hidden">
        <div className="border-b border-ink-200 p-4 dark:border-ink-800"><h2 className="font-display font-semibold">Transactions</h2></div>
        <div className="divide-y divide-ink-100 dark:divide-ink-850">
          {!summary.data?.transactions.length && <p className="muted p-6 text-center text-sm">No transactions yet.</p>}
          {summary.data?.transactions.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              {icon(t)}<div className="flex-1"><p>{t.op ? OP_LABEL[t.op] ?? t.op : t.reason ?? t.type}</p><p className="muted text-xs">{timeAgo(t.createdAt)}{t.status === 'refunded' && ' · refunded'}{t.status === 'reserved' && ' · in progress'}</p></div>
              <span className={t.type === 'debit' && t.status !== 'refunded' ? 'text-ember-500' : 'text-emerald-500'}>{t.type === 'debit' ? '−' : '+'}{Math.abs(t.amount)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
