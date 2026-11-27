import RazorpayCheckout from 'react-native-razorpay';
import { api } from './api';

/**
 * Native Razorpay Checkout (UPI intent, cards, netbanking, wallets).
 * The app NEVER decides that a payment succeeded — it forwards ids to the backend,
 * which verifies the HMAC signature (and the webhook) before granting anything.
 */
export async function payOrder(o: { orderId: string; amount: number; keyId: string; description: string }, prefill: { email?: string; name?: string }) {
  const r = await RazorpayCheckout.open({ key: o.keyId, order_id: o.orderId, amount: o.amount, currency: 'INR', name: 'Designo', description: o.description, prefill, theme: { color: '#7c5cff' } } as any);
  return api.post('/billing/verify', { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature });
}
export async function paySubscription(s: { subscriptionId: string; keyId: string }, description: string, prefill: { email?: string; name?: string }) {
  const r: any = await RazorpayCheckout.open({ key: s.keyId, subscription_id: s.subscriptionId, name: 'Designo', description, prefill, theme: { color: '#7c5cff' } } as any);
  return api.post('/billing/subscriptions/verify', { razorpay_payment_id: r.razorpay_payment_id, razorpay_subscription_id: r.razorpay_subscription_id, razorpay_signature: r.razorpay_signature });
}
/** Razorpay RN rejects with { code, description }. code 0 / 2 = user cancelled / network. */
export const razorpayMessage = (e: any) => {
  try { const d = typeof e?.description === 'string' ? JSON.parse(e.description) : e?.description; return d?.error?.description ?? d?.description ?? 'Payment cancelled'; }
  catch { return e?.description ?? e?.message ?? 'Payment cancelled'; }
};
