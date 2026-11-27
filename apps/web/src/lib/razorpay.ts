/** Loads Razorpay Checkout on demand. The success handler ONLY forwards ids to our backend for verification. */
declare global { interface Window { Razorpay?: any } }
let loading: Promise<void> | undefined;
export function loadRazorpay() {
  loading ??= new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(); s.onerror = () => { loading = undefined; reject(new Error('Could not load Razorpay Checkout')); };
    document.body.appendChild(s);
  });
  return loading;
}

export interface CheckoutOpts {
  keyId: string; orderId?: string; subscriptionId?: string; amount?: number; description: string;
  email?: string; name?: string;
  onSuccess: (resp: Record<string, string>) => void; onDismiss?: () => void; onFailure?: (msg: string) => void;
}
export async function openCheckout(o: CheckoutOpts) {
  await loadRazorpay();
  const rzp = new window.Razorpay({
    key: o.keyId, order_id: o.orderId, subscription_id: o.subscriptionId, amount: o.amount, currency: 'INR',
    name: 'Designo', description: o.description, prefill: { email: o.email, name: o.name },
    theme: { color: '#7c5cff' },
    handler: o.onSuccess,
    modal: { ondismiss: o.onDismiss, confirm_close: true },
  });
  rzp.on('payment.failed', (r: any) => o.onFailure?.(r?.error?.description ?? 'Payment failed'));
  rzp.open();
}
