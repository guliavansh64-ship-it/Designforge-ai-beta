import Razorpay from 'razorpay';
import { CREDIT_PACKS, type PlanDefinition, type PlanId } from '@designforge/shared';
import { env } from '../config.js';
import { db, C } from '../lib/firebase.js';
import { AppError, Errors } from '../lib/errors.js';
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js';
import { getPlan } from './plans.js';
import * as credits from './credits.js';
import { notify, track } from './notify.js';
import { logger } from '../lib/logger.js';

/**
 * Razorpay integration. Golden rules:
 *  1. Amounts are computed ONLY on the server from plan/pack catalogue + coupon.
 *  2. Checkout success in the client is never trusted: we verify the HMAC signature
 *     AND fetch the payment from Razorpay to confirm status + amount + order.
 *  3. Fulfilment is idempotent (Firestore transaction on payments/{orderId}); the
 *     verify endpoint and the webhook can both fire — credits are granted once.
 *  4. Webhooks are verified against RAZORPAY_WEBHOOK_SECRET on the RAW body and
 *     de-duplicated by x-razorpay-event-id.
 */

let rz: Razorpay | undefined;
function razorpay(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured on this server.');
  rz ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return rz;
}

export type Purchase =
  | { kind: 'plan'; planId: PlanId; cycle: 'monthly' | 'annual' | 'one_time' }
  | { kind: 'pack'; packId: string };

interface Priced { amountPaise: number; credits: number; description: string; plan?: PlanDefinition; periodDays?: number }

async function price(p: Purchase): Promise<Priced> {
  if (p.kind === 'pack') {
    const pack = CREDIT_PACKS.find((x) => x.id === p.packId);
    if (!pack) throw Errors.validation('Unknown credit pack');
    return { amountPaise: pack.priceInr * 100, credits: pack.credits, description: `${pack.credits} credit pack` };
  }
  const plan = await getPlan(p.planId);
  if (!plan.active || plan.id === 'free') throw Errors.validation('Plan not purchasable');
  if (plan.id === 'lifetime' || p.cycle === 'one_time') {
    if (!plan.priceInrOneTime) throw Errors.validation('Plan has no one-time price');
    return { amountPaise: plan.priceInrOneTime * 100, credits: plan.oneTimeCredits ?? 0, description: `${plan.name} (lifetime)`, plan };
  }
  const inr = p.cycle === 'annual' ? plan.priceInrAnnual : plan.priceInrMonthly;
  // Annual plans get the first month's allowance now; the rest arrives monthly via ensureMonthlyAllowance.
  const creditsNow = p.cycle === 'annual' ? Math.round(plan.annualCredits / 12) : plan.monthlyCredits;
  return { amountPaise: inr * 100, credits: creditsNow, description: `${plan.name} ${p.cycle}`, plan, periodDays: p.cycle === 'annual' ? 365 : 30 };
}

async function applyCoupon(code: string | undefined, uid: string, priced: Priced, p: Purchase) {
  if (!code) return { amountPaise: priced.amountPaise, coupon: undefined as string | undefined };
  const ref = db().collection(C.coupons).doc(code.toUpperCase());
  const c = (await ref.get()).data();
  const now = Date.now();
  if (!c || !c.active || (c.expiresAt && c.expiresAt < now) || (c.maxRedemptions && c.redeemed >= c.maxRedemptions)) throw Errors.validation('Coupon is invalid or expired');
  const target = p.kind === 'pack' ? 'packs' : p.planId;
  if (c.appliesTo?.length && !c.appliesTo.includes(target)) throw Errors.validation('Coupon does not apply to this purchase');
  if (c.type === 'credits') throw Errors.validation('This is a credit coupon — redeem it on the Credits page');
  const used = await ref.collection('redemptions').doc(uid).get();
  if (used.exists && c.oncePerUser !== false) throw Errors.validation('You have already used this coupon');
  const off = c.type === 'percent' ? Math.round((priced.amountPaise * Math.min(c.value, 100)) / 100) : Math.round(c.value * 100);
  return { amountPaise: Math.max(100, priced.amountPaise - off), coupon: code.toUpperCase() }; // Razorpay min ₹1
}

export async function createOrder(uid: string, p: Purchase, couponCode?: string) {
  const priced = await price(p);
  const { amountPaise, coupon } = await applyCoupon(couponCode, uid, priced, p);
  const receipt = `df_${uid.slice(0, 10)}_${Date.now()}`.slice(0, 40);
  const order = await razorpay().orders.create({ amount: amountPaise, currency: 'INR', receipt, notes: { uid, kind: p.kind, ref: p.kind === 'pack' ? p.packId : `${p.planId}:${p.cycle}` } });
  await db().collection(C.payments).doc(order.id).set({
    ownerId: uid, orderId: order.id, status: 'created', amountPaise, currency: 'INR', purchase: p,
    credits: priced.credits, periodDays: priced.periodDays ?? null, description: priced.description,
    coupon: coupon ?? null, listAmountPaise: priced.amountPaise, createdAt: Date.now(),
  });
  return { orderId: order.id, amount: amountPaise, currency: 'INR', keyId: env.RAZORPAY_KEY_ID, description: priced.description };
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  return safeEqualHex(hmacSha256Hex(env.RAZORPAY_KEY_SECRET!, `${orderId}|${paymentId}`), signature);
}
export function verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: string) {
  return safeEqualHex(hmacSha256Hex(env.RAZORPAY_KEY_SECRET!, `${paymentId}|${subscriptionId}`), signature);
}
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  return safeEqualHex(hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody.toString()), signature);
}

export async function verifyAndFulfill(uid: string, orderId: string, paymentId: string, signature: string) {
  const pay = await db().collection(C.payments).doc(orderId).get();
  if (!pay.exists || pay.get('ownerId') !== uid) throw Errors.notFound('Order');
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    await pay.ref.update({ status: 'signature_failed', lastAttemptAt: Date.now() });
    throw new AppError(400, 'PAYMENT_INVALID', 'Payment signature verification failed.');
  }
  const p = await razorpay().payments.fetch(paymentId);
  if (p.order_id !== orderId || Number(p.amount) !== pay.get('amountPaise')) throw new AppError(400, 'PAYMENT_INVALID', 'Payment does not match the order.');
  if (p.status === 'authorized') await razorpay().payments.capture(paymentId, Number(p.amount), 'INR');
  else if (p.status !== 'captured') {
    await pay.ref.update({ status: p.status === 'failed' ? 'failed' : 'pending', paymentId });
    throw new AppError(402, 'PAYMENT_PENDING', `Payment is ${p.status}. We'll update automatically when Razorpay confirms.`);
  }
  return fulfillOrder(orderId, paymentId, String(p.method ?? ''));
}

/** Idempotent: safe to call from verify endpoint and webhook concurrently. */
export async function fulfillOrder(orderId: string, paymentId: string, method = '') {
  const ref = db().collection(C.payments).doc(orderId);
  const result = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { already: true, data: undefined as any };
    const d = s.data()!;
    if (d.status === 'paid') return { already: true, data: d };
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    tx.update(ref, { status: 'paid', paymentId, method, paidAt: Date.now(), invoiceNumber: `DF-${ym}-${orderId.slice(-6).toUpperCase()}` });
    return { already: false, data: d };
  });
  if (result.already || !result.data) return { ok: true, duplicate: true };
  const d = result.data;
  const uid: string = d.ownerId;
  const purchase = d.purchase as Purchase;

  if (purchase.kind === 'plan') {
    const now = Date.now();
    const subRef = db().collection(C.subscriptions).doc(uid);
    await db().runTransaction(async (tx) => {
      const cur = (await tx.get(subRef)).data();
      // Renewal of same plan extends from current end; upgrade/new starts now.
      const base = cur?.planId === purchase.planId && cur?.currentPeriodEnd > now ? cur.currentPeriodEnd : now;
      tx.set(subRef, {
        ownerId: uid, planId: purchase.planId, cycle: purchase.cycle, status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: d.periodDays ? base + d.periodDays * 86400_000 : null,
        cancelAtPeriodEnd: false, pendingPlanId: null, expiryWarned: false, lastOrderId: orderId, updatedAt: now,
      }, { merge: true });
    });
    // Reset allowance period so the new plan's allowance applies cleanly.
    await db().collection(C.wallets).doc(uid).set({ periodKey: new Date().toISOString().slice(0, 7), allowanceRemaining: d.credits }, { merge: true });
  }
  if (d.credits > 0) await credits.grant(uid, d.credits, d.description, `order_${orderId}`, { orderId, paymentId });
  if (d.coupon) {
    const cRef = db().collection(C.coupons).doc(d.coupon);
    await db().runTransaction(async (tx) => {
      const r = await tx.get(cRef.collection('redemptions').doc(uid));
      if (r.exists) return;
      const c = await tx.get(cRef);
      tx.set(cRef.collection('redemptions').doc(uid), { orderId, at: Date.now() });
      tx.update(cRef, { redeemed: (c.get('redeemed') ?? 0) + 1 });
    });
  }
  await track('revenue_paise', d.amountPaise);
  await track(purchase.kind === 'plan' ? `purchase_plan_${purchase.planId}` : 'purchase_pack');
  await notify(uid, 'payment_success', 'Payment successful', `${d.description} — ₹${(d.amountPaise / 100).toFixed(2)}. ${d.credits} credits added.`);
  return { ok: true, duplicate: false };
}

// ── Razorpay Subscriptions (auto-renew). Requires plan.razorpayPlanIds[cycle] set by admin.
export async function createAutoRenewSubscription(uid: string, planId: PlanId, cycle: 'monthly' | 'annual') {
  const plan: any = await getPlan(planId);
  const rzPlan = plan.razorpayPlanIds?.[cycle];
  if (!rzPlan) throw Errors.validation('Auto-renew is not configured for this plan. Use a one-time period purchase.');
  const sub = await razorpay().subscriptions.create({ plan_id: rzPlan, total_count: cycle === 'annual' ? 10 : 120, customer_notify: 1, notes: { uid, planId, cycle } });
  await db().collection(C.subscriptions).doc(uid).set({ ownerId: uid, pendingRazorpaySubscriptionId: sub.id, pendingPlanId: planId, updatedAt: Date.now() }, { merge: true });
  return { subscriptionId: sub.id, keyId: env.RAZORPAY_KEY_ID };
}

export async function cancelSubscription(uid: string) {
  const ref = db().collection(C.subscriptions).doc(uid);
  const s = (await ref.get()).data();
  if (!s || s.planId === 'free') throw Errors.validation('No active paid subscription');
  if (s.razorpaySubscriptionId) await razorpay().subscriptions.cancel(s.razorpaySubscriptionId, true); // at cycle end
  await ref.update({ cancelAtPeriodEnd: true, status: s.planId === 'lifetime' ? 'active' : 'cancelled', updatedAt: Date.now() });
}

export async function handleWebhook(rawBody: Buffer, signature: string, eventId: string | undefined) {
  if (!verifyWebhookSignature(rawBody, signature)) throw new AppError(400, 'PAYMENT_INVALID', 'Invalid webhook signature');
  const evt = JSON.parse(rawBody.toString());
  const id = eventId || `${evt.event}_${evt.payload?.payment?.entity?.id ?? evt.payload?.subscription?.entity?.id ?? evt.created_at}`;
  const evRef = db().collection(C.webhookEvents).doc(id);
  const fresh = await db().runTransaction(async (tx) => {
    if ((await tx.get(evRef)).exists) return false;
    tx.set(evRef, { event: evt.event, receivedAt: Date.now() });
    return true;
  });
  if (!fresh) return { duplicate: true };

  const payment = evt.payload?.payment?.entity;
  const subscription = evt.payload?.subscription?.entity;
  switch (evt.event) {
    case 'payment.captured':
    case 'order.paid':
      if (payment?.order_id && (await db().collection(C.payments).doc(payment.order_id).get()).exists) await fulfillOrder(payment.order_id, payment.id, payment.method);
      break;
    case 'payment.failed': {
      const ref = payment?.order_id && db().collection(C.payments).doc(payment.order_id);
      if (ref) {
        const s = await ref.get();
        if (s.exists && s.get('status') !== 'paid') {
          await ref.update({ status: 'failed', failureReason: payment.error_description ?? 'failed' });
          await notify(s.get('ownerId'), 'payment_failed', 'Payment failed', payment.error_description ?? 'Your payment could not be completed. No money was taken, or it will be auto-refunded by your bank.');
        }
      }
      break;
    }
    case 'refund.processed': {
      const refund = evt.payload?.refund?.entity;
      const q = await db().collection(C.payments).where('paymentId', '==', refund?.payment_id).limit(1).get();
      if (!q.empty) await q.docs[0].ref.update({ refundStatus: 'processed', refundedPaise: refund.amount, refundedAt: Date.now() });
      break;
    }
    case 'subscription.activated':
    case 'subscription.charged': {
      const uid = subscription?.notes?.uid; const planId = subscription?.notes?.planId; const cycle = subscription?.notes?.cycle;
      if (!uid || !planId) break;
      const plan = await getPlan(planId);
      const end = (subscription.current_end ?? 0) * 1000 || Date.now() + (cycle === 'annual' ? 365 : 30) * 86400_000;
      await db().collection(C.subscriptions).doc(uid).set({
        ownerId: uid, planId, cycle, status: 'active', razorpaySubscriptionId: subscription.id,
        currentPeriodStart: (subscription.current_start ?? 0) * 1000 || Date.now(), currentPeriodEnd: end,
        cancelAtPeriodEnd: false, expiryWarned: false, updatedAt: Date.now(),
      }, { merge: true });
      if (evt.event === 'subscription.charged' && payment?.id) {
        const amt = cycle === 'annual' ? Math.round(plan.annualCredits / 12) : plan.monthlyCredits;
        await credits.grant(uid, amt, `${plan.name} renewal`, `sub_${subscription.id}_${payment.id}`);
        await db().collection(C.payments).doc(`sub_${payment.id}`).set({ ownerId: uid, status: 'paid', amountPaise: payment.amount, paymentId: payment.id, description: `${plan.name} ${cycle} renewal`, subscriptionId: subscription.id, paidAt: Date.now(), createdAt: Date.now(), invoiceNumber: `DF-R-${payment.id.slice(-8).toUpperCase()}` });
        await notify(uid, 'subscription_renewed', 'Subscription renewed', `${plan.name} renewed. ${amt} credits added.`);
      }
      break;
    }
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.halted': {
      const uid = subscription?.notes?.uid;
      if (uid) await db().collection(C.subscriptions).doc(uid).set({ status: evt.event === 'subscription.halted' ? 'halted' : 'cancelled', cancelAtPeriodEnd: true, updatedAt: Date.now() }, { merge: true });
      break;
    }
    default:
      logger.info({ event: evt.event }, 'unhandled razorpay event');
  }
  return { duplicate: false };
}

export async function refundPayment(orderId: string, amountPaise?: number, reason = 'admin_refund') {
  const ref = db().collection(C.payments).doc(orderId);
  const d = (await ref.get()).data();
  if (!d?.paymentId || d.status !== 'paid') throw Errors.validation('Payment is not refundable');
  const r = await razorpay().payments.refund(d.paymentId, { amount: amountPaise ?? d.amountPaise, notes: { reason } });
  await ref.update({ refundStatus: r.status, refundId: r.id, refundRequestedAt: Date.now() });
  // Claw back unspent credits from this order (never below zero).
  if (d.credits > 0) {
    const bal = await credits.getBalance(d.ownerId);
    const claw = Math.min(bal, Math.round(d.credits * ((amountPaise ?? d.amountPaise) / d.amountPaise)));
    if (claw > 0) await credits.grant(d.ownerId, -claw, `Refund of ${orderId}`, `refund_${orderId}`);
  }
  return r;
}
