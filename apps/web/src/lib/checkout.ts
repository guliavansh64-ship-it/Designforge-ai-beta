import { api } from './api';
import { openCheckout } from './razorpay';

/**
 * One purchase flow for every provider. With ZetPay (UPI) the browser goes to the ZetPay payment
 * page and comes back to /credits?zp_order=… — the server then confirms with ZetPay (never trusts
 * the redirect) and Credits.tsx polls /billing/zetpay/status until the order is paid/failed.
 */
export type Purchase = { kind: 'pack'; packId: string } | { kind: 'plan'; planId: string; cycle: 'monthly' | 'annual' | 'one_time' };
export interface PlansInfo { paymentsProvider: 'zetpay' | 'razorpay' | null; paymentsEnabled?: boolean; maxAmountInr: number | null; razorpayKeyId: string | null }

type OrderResp =
  | { provider: 'zetpay'; orderId: string; paymentUrl: string; amount: number; description: string }
  | { provider: 'razorpay'; orderId: string; amount: number; keyId: string; description: string };

export async function startPurchase(purchase: Purchase, o: { coupon?: string; email?: string; name?: string; onPaid: () => void | Promise<void>; onError: (m: string) => void; onDismiss?: () => void }) {
  const r = await api.post<OrderResp>('/billing/orders', { purchase, coupon: o.coupon || undefined, client: 'web' });
  if (r.provider === 'zetpay') {
    sessionStorage.setItem('df_pending_order', r.orderId);
    window.location.assign(r.paymentUrl);
    return;
  }
  await openCheckout({
    keyId: r.keyId, orderId: r.orderId, amount: r.amount, description: r.description, email: o.email, name: o.name,
    onSuccess: async (resp) => { try { await api.post('/billing/verify', resp); await o.onPaid(); } catch (e) { o.onError(`${(e as Error).message}. If you were charged, it will be added automatically.`); } },
    onFailure: (m) => o.onError(`Payment failed: ${m}. You have not been charged.`), onDismiss: o.onDismiss,
  });
}

/** Polls our server (which checks ZetPay) — every 4 s for up to ~5 min. */
export async function waitForZetpay(orderId: string, onTick?: (s: string) => void): Promise<'paid' | 'failed' | 'pending'> {
  const t0 = Date.now();
  while (Date.now() - t0 < 5 * 60_000) {
    try {
      const s = await api.get<{ status: 'paid' | 'failed' | 'pending' | 'success' }>(`/billing/zetpay/status/${encodeURIComponent(orderId)}`);
      onTick?.(s.status);
      if (s.status === 'paid' || s.status === 'success') return 'paid';
      if (s.status === 'failed') return 'failed';
    } catch { /* transient */ }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return 'pending';
}

export const canAfford = (info: PlansInfo | undefined | null, inr: number) => !info?.maxAmountInr || inr <= info.maxAmountInr;
