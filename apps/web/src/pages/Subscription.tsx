import { useState } from 'react';
import { Check, Crown, Infinity as Inf, Zap, Sparkles, Receipt, ExternalLink } from 'lucide-react';
import type { PlanDefinition } from '@designforge/shared';
import { api, idToken, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, inr } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { openCheckout } from '../lib/razorpay';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Tabs, cx } from '../components/ui';

const FEATURE_LABEL: Record<string, string> = { ui_generation: 'UI generation via your Stitch', website_studio: 'Website Studio', logo_studio: 'Logo & Brand Studio', html_export: 'HTML export', react_export: 'React + TypeScript export', auto_improve: 'Auto-improve (multi-iteration)', variants: 'Design variations', pro_model: 'Gemini 3.1 Pro model', priority_queue: 'Priority queue', project_sharing: 'Project sharing' };
const ICON = { free: Zap, pro: Sparkles, premium: Crown, lifetime: Inf } as const;
interface Payment { id: string; status: string; amountPaise: number; description: string; invoiceNumber?: string; method?: string; createdAt: number }

export default function Subscription() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const plans = useApi<{ plans: PlanDefinition[]; razorpayKeyId: string | null }>('/plans');
  const summary = useApi<{ payments: Payment[] }>('/billing/summary');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [autoRenew, setAutoRenew] = useState(true);
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const sub = me?.subscription;
  const current = me?.plan.id;

  const purchase = async (p: PlanDefinition) => {
    setBusy(p.id); setErr(null);
    const done = async (msg: string) => { toast('success', msg); await Promise.all([refresh(), summary.reload()]); };
    try {
      if (p.id !== 'lifetime' && autoRenew && !coupon) {
        const s = await api.post<{ subscriptionId: string; keyId: string }>('/billing/subscriptions', { planId: p.id, cycle });
        await openCheckout({ keyId: s.keyId, subscriptionId: s.subscriptionId, description: `${p.name} (${cycle}, auto-renew)`, email: me?.user.email, name: me?.user.displayName ?? undefined,
          onSuccess: async (resp) => { try { await api.post('/billing/subscriptions/verify', resp); await done('Payment received. Your plan activates as soon as Razorpay confirms (usually seconds).'); setTimeout(refresh, 6000); } catch (e) { toast('error', (e as Error).message); } },
          onFailure: (m) => toast('error', `Payment failed: ${m}`), onDismiss: () => setBusy(null) });
      } else {
        const o = await api.post<{ orderId: string; amount: number; keyId: string; description: string }>('/billing/orders', { purchase: { kind: 'plan', planId: p.id, cycle: p.id === 'lifetime' ? 'one_time' : cycle }, coupon: coupon || undefined });
        await openCheckout({ keyId: o.keyId, orderId: o.orderId, amount: o.amount, description: o.description, email: me?.user.email, name: me?.user.displayName ?? undefined,
          onSuccess: async (resp) => { try { await api.post('/billing/verify', resp); await done(`Welcome to ${p.name}!`); } catch (e) { toast('error', `${(e as Error).message}. If you were charged, your plan will activate automatically via webhook.`); } },
          onFailure: (m) => toast('error', `Payment failed: ${m}`), onDismiss: () => setBusy(null) });
      }
    } catch (e) { setErr(e as ApiError); } finally { setBusy(null); }
  };
  const cancel = async () => { setConfirmCancel(false); try { await api.post('/billing/cancel'); toast('success', 'Auto-renew cancelled. You keep your plan until the end of the current period.'); refresh(); } catch (e) { toast('error', (e as Error).message); } };
  const invoice = async (id: string) => {
    const t = await idToken();
    const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api/billing/invoices/${id}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!res.ok) return toast('error', 'Invoice unavailable');
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (!window.open(url, '_blank')) toast('error', 'Allow pop-ups to view the invoice');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div>
      <PageHeader title="Subscription" subtitle="Plans unlock DesignForge features and monthly credits. AI generation always runs on your own Google account and its quota." />
      {sub && current !== 'free' && (
        <Card className="mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <div className="flex-1"><p className="font-medium">You're on <b>{me?.plan.name}</b> {sub.cycle !== 'one_time' && `(${sub.cycle})`}</p>
            <p className="muted text-sm">{current === 'lifetime' ? 'Lifetime access — no renewals.' : sub.cancelAtPeriodEnd ? `Ends on ${new Date(sub.currentPeriodEnd!).toLocaleDateString('en-IN')}${sub.pendingPlanId ? ` → then ${sub.pendingPlanId}` : ''}` : sub.currentPeriodEnd ? `Renews / ends ${new Date(sub.currentPeriodEnd).toLocaleDateString('en-IN')}` : ''}{sub.status !== 'active' && ` · status: ${sub.status}`}</p></div>
          {current !== 'lifetime' && !sub.cancelAtPeriodEnd && <div className="flex gap-2"><Button variant="ghost" onClick={async () => { await api.post('/billing/downgrade', { toPlanId: current === 'premium' ? 'pro' : 'free' }); toast('success', 'Downgrade scheduled for the end of this period.'); refresh(); }}>Downgrade</Button><Button variant="secondary" onClick={() => setConfirmCancel(true)}>Cancel auto-renew</Button></div>}
        </Card>
      )}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={cycle} onChange={setCycle} items={[{ id: 'monthly', label: 'Monthly' }, { id: 'annual', label: 'Annual · save ~20%' }]} />
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-forge-500" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />Auto-renew</label>
          <input className="field !w-36 !py-1.5" placeholder="Coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} maxLength={40} />
        </div>
      </div>
      {coupon && autoRenew && <p className="muted -mt-3 mb-4 text-xs">Coupons apply to one-time payments; auto-renew is turned off while a coupon is entered.</p>}
      <ErrorBox error={err} className="mb-5" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.data?.plans.filter((p) => p.active).map((p) => {
          const I = ICON[p.id]; const isCur = current === p.id;
          const price = p.id === 'lifetime' ? p.priceInrOneTime! : cycle === 'annual' ? p.priceInrAnnual : p.priceInrMonthly;
          return (
            <Card key={p.id} className={cx('relative flex flex-col p-6', p.id === 'premium' && 'ring-2 ring-forge-500 shadow-glow')}>
              {p.id === 'premium' && <Badge tone="forge" className="absolute right-4 top-4">Most popular</Badge>}
              <I className="h-6 w-6 text-forge-500" /><p className="mt-3 font-display text-lg font-semibold">{p.name}</p><p className="muted text-xs">{p.tagline}</p>
              <p className="mt-4 font-display text-3xl font-semibold">{price ? `₹${price.toLocaleString('en-IN')}` : '₹0'}<span className="muted text-sm font-normal">{p.id === 'lifetime' ? ' once' : price ? (cycle === 'annual' ? '/yr' : '/mo') : ''}</span></p>
              <p className="muted text-xs">{p.id === 'lifetime' ? `${p.oneTimeCredits?.toLocaleString('en-IN')} credits included` : `${(cycle === 'annual' ? p.annualCredits : p.monthlyCredits).toLocaleString('en-IN')} credits / ${cycle === 'annual' ? 'year' : 'month'}`} · {p.maxProjects} projects</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{FEATURE_LABEL[f] ?? f}</li>)}
                {p.maxImproveIterations > 1 && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />Up to {p.maxImproveIterations} improve iterations</li>}</ul>
              {p.id === 'free' ? <Button className="mt-6" variant="secondary" disabled>{isCur ? 'Current plan' : 'Included'}</Button>
                : <Button className="mt-6" variant={p.id === 'premium' ? 'ember' : 'primary'} disabled={isCur || !plans.data?.razorpayKeyId} loading={busy === p.id} onClick={() => purchase(p)}>{isCur ? 'Current plan' : `Get ${p.name}`}</Button>}
            </Card>
          );
        })}
      </div>
      <p className="muted mt-4 text-xs">Payments by Razorpay: UPI, cards, netbanking & wallets. Prices in INR. Lifetime covers DesignForge platform features for the life of the product; it does not include Google's Stitch/Gemini usage, which stays on your own account. Annual plans grant credits monthly.</p>

      <Card className="mt-8 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-ink-200 p-4 dark:border-ink-800"><Receipt className="h-4 w-4" /><h2 className="font-display font-semibold">Billing history</h2></div>
        {!summary.data?.payments.length ? <p className="muted p-6 text-center text-sm">No payments yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{summary.data.payments.map((p) => (
              <tr key={p.id}><td className="p-3">{new Date(p.createdAt).toLocaleDateString('en-IN')}</td><td className="p-3">{p.description}{p.method && <span className="muted"> · {p.method}</span>}</td><td className="p-3">{inr(p.amountPaise)}</td>
                <td className="p-3"><Badge tone={p.status === 'paid' ? 'green' : p.status === 'failed' ? 'red' : p.status === 'refunded' ? 'amber' : 'neutral'}>{p.status}</Badge></td>
                <td className="p-3 text-right">{p.status === 'paid' && <button onClick={() => invoice(p.id)} className="inline-flex items-center gap-1 text-xs text-forge-500 hover:underline">Invoice <ExternalLink className="h-3 w-3" /></button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel auto-renew?">
        <p className="text-sm">You'll keep {me?.plan.name} features and remaining credits until the end of your current period, then move to Free. Your projects stay safe.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep plan</Button><Button variant="danger" onClick={cancel}>Cancel auto-renew</Button></div>
      </Modal>
    </div>
  );
}
