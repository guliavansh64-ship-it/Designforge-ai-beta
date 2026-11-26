import * as WebBrowser from 'expo-web-browser';
import { api } from './api';
import { payOrder, razorpayMessage } from './razorpay';

/**
 * Unified purchase flow. ZetPay (UPI): open the payment page in a Chrome Custom Tab; ZetPay redirects
 * to our server, which bounces to designforge://billing and closes the tab. Then we poll OUR server
 * (it checks ZetPay — the redirect itself is never trusted). Razorpay stays as a fallback provider.
 */
export type Purchase = { kind: 'pack'; packId: string } | { kind: 'plan'; planId: string; cycle: 'monthly' | 'annual' | 'one_time' };
export type PayResult = 'paid' | 'failed' | 'pending' | 'cancelled';

type OrderResp =
  | { provider: 'zetpay'; orderId: string; paymentUrl: string; amount: number; description: string }
  | { provider: 'razorpay'; orderId: string; amount: number; keyId: string; description: string };

export async function waitForPayment(orderId: string, maxMs = 90_000, onTick?: (s: string) => void): Promise<'paid' | 'failed' | 'pending'> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const s = await api.get<{ status: string }>(`/billing/zetpay/status/${encodeURIComponent(orderId)}`);
      onTick?.(s.status);
      if (s.status === 'paid' || s.status === 'success') return 'paid';
      if (s.status === 'failed') return 'failed';
    } catch { /* transient network / cold start */ }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return 'pending';
}

export async function purchase(p: Purchase, opts: { coupon?: string; prefill: { email?: string; name?: string }; onChecking?: () => void }): Promise<{ result: PayResult; message?: string; orderId?: string }> {
  const o = await api.post<OrderResp>('/billing/orders', { purchase: p, coupon: opts.coupon || undefined, client: 'app' });
  if (o.provider === 'zetpay') {
    const r = await WebBrowser.openAuthSessionAsync(o.paymentUrl, 'designforge://billing', { showTitle: true, toolbarColor: '#0b0b12', enableBarCollapsing: true });
    opts.onChecking?.();
    // Whether the tab closed via redirect or the user pressed back, the server decides.
    const status = await waitForPayment(o.orderId, r.type === 'success' ? 60_000 : 20_000);
    if (status === 'pending' && r.type !== 'success') return { result: 'cancelled', orderId: o.orderId };
    return { result: status, orderId: o.orderId };
  }
  try {
    await payOrder(o, opts.prefill);
    return { result: 'paid' };
  } catch (e: any) {
    if (e?.status) throw e;
    return { result: 'cancelled', message: razorpayMessage(e) };
  }
}
