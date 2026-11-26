import { env, publicApiUrl } from '../config.js';
import { db, C } from '../lib/firebase.js';
import { AppError, Errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { applyCoupon, fulfillOrder, price, type Purchase } from './billing.js';

/**
 * ZetPay (UPI payment links).
 *  - Amounts are computed ONLY on the server (price + coupon), in whole rupees, ₹1–₹5000 per order.
 *  - The redirect back to us is NEVER proof of payment: we fulfil only after a server-side
 *    GET /order-status says `success` (fulfilOrder is idempotent).
 *  - ZetPay allows 60 API calls / 15 min per key (shared by all users), so status checks are cached
 *    per order and globally budgeted; the client polls OUR server, never ZetPay.
 */

export const ZETPAY_MAX_INR = 5000;
export const ZETPAY_MIN_INR = 1;

export type ZetStatus = 'pending' | 'success' | 'failed';

// ── Global call budget (stay under 60 / 15 min with headroom for create-order).
const WINDOW = 15 * 60_000;
const BUDGET = 54;
const calls: number[] = [];
function takeBudget(priority = false) {
  const now = Date.now();
  while (calls.length && calls[0] < now - WINDOW) calls.shift();
  // Status checks may only use 44 of the 54; creates may use them all (a buyer is waiting).
  if (calls.length >= (priority ? BUDGET : BUDGET - 10)) return false;
  calls.push(now);
  return true;
}

function key() {
  if (!env.ZETPAY_API_KEY) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured on this server yet.');
  return env.ZETPAY_API_KEY;
}

async function zp<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; data?: T }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(`${env.ZETPAY_BASE_URL.replace(/\/$/, '')}/api/developer/${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-ZetAPI-Key': key(), ...(init.headers ?? {}) },
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body, data: body?.data };
  } finally {
    clearTimeout(t);
  }
}

function zpError(status: number, body: any): AppError {
  const msg = String(body?.message ?? body?.error ?? '').slice(0, 200);
  if (status === 429) return new AppError(429, 'PAYMENTS_BUSY', 'Payment gateway is busy. Please try again in a minute.');
  if (status === 503) return new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payment gateway is under maintenance. Please try again shortly.');
  if (status === 401 || status === 403) {
    logger.error({ status, msg }, 'zetpay key rejected');
    return new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are temporarily unavailable. Please try again later.');
  }
  return new AppError(400, 'PAYMENT_FAILED', msg || 'Could not create the payment.');
}

/** Returns the payment page URL for a server-priced purchase. */
export async function createZetpayOrder(uid: string, p: Purchase, opts: { coupon?: string; client: 'app' | 'web'; mobile?: string }) {
  const priced = await price(p);
  const { amountPaise: discounted, coupon } = await applyCoupon(opts.coupon, uid, priced, p);
  const amountInr = Math.max(ZETPAY_MIN_INR, Math.round(discounted / 100)); // whole rupees
  if (amountInr > ZETPAY_MAX_INR) {
    throw new AppError(400, 'AMOUNT_TOO_HIGH', `UPI payments are limited to ₹${ZETPAY_MAX_INR.toLocaleString('en-IN')} per order. Choose a monthly plan or a smaller pack.`);
  }
  if (!takeBudget(true)) throw new AppError(429, 'PAYMENTS_BUSY', 'Payment gateway is busy. Please try again in a minute.');
  const mobile = opts.mobile && /^(\+?91|0)?[6-9]\d{9}$/.test(opts.mobile) ? opts.mobile : undefined;
  const r = await zp<{ order_id: string; payment_url: string; amount: number; mode: 'live' | 'test' }>('create-order', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountInr,
      title: `DesignForge AI — ${priced.description}`.slice(0, 100),
      ...(mobile ? { customer_mobile: mobile } : {}),
      redirect_url: `${publicApiUrl()}/api/billing/zetpay/return/${opts.client}`,
      useEmbedded: false,
    }),
  });
  if (r.status >= 400 || !r.body?.success || !r.data?.order_id || !r.data?.payment_url) throw zpError(r.status, r.body);
  const { order_id: orderId, payment_url: paymentUrl, mode } = r.data;
  await db().collection(C.payments).doc(orderId).set({
    ownerId: uid, orderId, provider: 'zetpay', mode, status: 'created', amountPaise: amountInr * 100, currency: 'INR', purchase: p,
    credits: priced.credits, periodDays: priced.periodDays ?? null, description: priced.description,
    coupon: coupon ?? null, listAmountPaise: priced.amountPaise, paymentUrl, createdAt: Date.now(),
  });
  return { provider: 'zetpay' as const, orderId, paymentUrl, amount: amountInr * 100, currency: 'INR', description: priced.description, mode };
}

// Per-order cache so many clients polling don't burn the shared ZetPay quota.
const cache = new Map<string, { at: number; status: ZetStatus }>();

/**
 * Server-side status check (+ fulfilment on success). Safe to call repeatedly and concurrently.
 * `uid` is checked when given (client polling); the public return page passes undefined.
 */
export async function checkZetpayOrder(orderId: string, uid?: string): Promise<{ status: ZetStatus | 'paid'; description?: string; credits?: number }> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) throw Errors.notFound('Order');
  const ref = db().collection(C.payments).doc(orderId);
  const snap = await ref.get();
  const d = snap.data();
  if (!d || d.provider !== 'zetpay' || (uid && d.ownerId !== uid)) throw Errors.notFound('Order');
  if (d.status === 'paid') return { status: 'paid', description: d.description, credits: d.credits };
  if (d.status === 'failed') return { status: 'failed', description: d.description };

  const hit = cache.get(orderId);
  let status: ZetStatus = 'pending';
  if (hit && Date.now() - hit.at < 4_000) status = hit.status;
  else if (!takeBudget()) status = 'pending';
  else {
    const r = await zp<{ status: string; amount?: number }>(`order-status/${encodeURIComponent(orderId)}`);
    if (r.status === 404) throw Errors.notFound('Order');
    if (r.status >= 400) {
      logger.warn({ status: r.status, orderId }, 'zetpay status check failed');
      status = 'pending';
    } else {
      const s = String(r.data?.status ?? 'pending').toLowerCase();
      status = s === 'success' ? 'success' : s === 'failed' ? 'failed' : 'pending';
      // Defence in depth: the amount ZetPay reports must match what we priced.
      if (status === 'success' && r.data?.amount != null && Math.round(Number(r.data.amount) * 100) !== d.amountPaise) {
        logger.error({ orderId, reported: r.data.amount, expected: d.amountPaise }, 'zetpay amount mismatch');
        await ref.update({ status: 'amount_mismatch', checkedAt: Date.now() });
        throw new AppError(400, 'PAYMENT_INVALID', 'Payment amount does not match the order. Contact support.');
      }
    }
    cache.set(orderId, { at: Date.now(), status });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }

  if (status === 'success') {
    await fulfillOrder(orderId, orderId, 'upi');
    return { status: 'paid', description: d.description, credits: d.credits };
  }
  if (status === 'failed') {
    await ref.update({ status: 'failed', checkedAt: Date.now() });
    const { notify } = await import('./notify.js');
    await notify(d.ownerId, 'payment_failed', 'Payment failed', `${d.description} — the UPI payment did not complete. No money was taken; if it was, it will be refunded by your bank.`).catch(() => undefined);
    return { status: 'failed', description: d.description };
  }
  await ref.update({ status: 'pending', checkedAt: Date.now() }).catch(() => undefined);
  return { status: 'pending', description: d.description };
}

/**
 * Background reconciler: catches payments where the buyer closed the app before we confirmed.
 * Checks a few recent pending ZetPay orders per minute (within the shared quota).
 */
export function startZetpayReconciler() {
  if (!env.ZETPAY_API_KEY) return;
  const tick = async () => {
    try {
      const since = Date.now() - 2 * 3600_000;
      // Single-field range query (auto-indexed; no composite index needed).
      const s = await db().collection(C.payments).where('createdAt', '>=', since).limit(100).get();
      const pending = s.docs.filter((x) => x.get('provider') === 'zetpay' && ['created', 'pending'].includes(x.get('status'))).sort((a, b) => (a.get('checkedAt') ?? 0) - (b.get('checkedAt') ?? 0)).slice(0, 2);
      for (const p of pending) {
        await checkZetpayOrder(p.id).catch((e) => logger.warn({ err: e, orderId: p.id }, 'zetpay reconcile failed'));
      }
    } catch (e) {
      logger.warn({ err: e }, 'zetpay reconciler tick failed');
    }
  };
  const t = setInterval(tick, 75_000);
  t.unref?.();
}
