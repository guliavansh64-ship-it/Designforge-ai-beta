import { Router } from 'express';
import { z } from 'zod';
import { CREDIT_PACKS } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { ah, validate } from '../middleware/validate.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { listPlans, getEntitlements } from '../services/plans.js';
import { cancelSubscription, createAutoRenewSubscription, createOrder, verifyAndFulfill, verifySubscriptionSignature } from '../services/billing.js';
import * as credits from '../services/credits.js';
import { AppError, Errors } from '../lib/errors.js';
import { env, razorpayEnabled, zetpayEnabled } from '../config.js';
import { checkZetpayOrder, createZetpayOrder, ZETPAY_MAX_INR } from '../services/zetpay.js';
import { safeQuery } from '../lib/safeQuery.js';

export const billingPublicRouter = Router();
const provider = () => (zetpayEnabled ? 'zetpay' : razorpayEnabled ? 'razorpay' : null);
billingPublicRouter.get('/plans', ah(async (_req, res) => res.json({
  plans: await listPlans(), packs: CREDIT_PACKS,
  paymentsProvider: provider(),
  paymentsEnabled: !!provider(),
  maxAmountInr: provider() === 'zetpay' ? ZETPAY_MAX_INR : null,
  // Only exposed when Razorpay is the active provider (legacy clients).
  razorpayKeyId: provider() === 'razorpay' ? env.RAZORPAY_KEY_ID ?? null : null,
})));

/**
 * ZetPay redirects the buyer here (?zp_order=…&zp_result=…). The query is NOT trusted: we check the
 * order server-side, then bounce the browser back to the app (deep link) or the website.
 */
billingPublicRouter.get('/billing/zetpay/return/:client', ah(async (req, res) => {
  const orderId = String(req.query.zp_order ?? '').slice(0, 80);
  let status = 'pending';
  if (orderId) {
    try { status = (await checkZetpayOrder(orderId)).status; } catch { status = 'unknown'; }
  }
  const qs = `zp_order=${encodeURIComponent(orderId)}&status=${encodeURIComponent(status)}`;
  const target = req.params.client === 'web' ? `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/credits?${qs}` : `designforge://billing?${qs}`;
  const ok = status === 'paid';
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Designo</title>
<meta http-equiv="refresh" content="1;url=${target.replace(/"/g, '&quot;')}"></head>
<body style="font-family:system-ui;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
<div><div style="font-size:42px">${ok ? '✅' : status === 'failed' ? '❌' : '⏳'}</div><h2>${ok ? 'Payment successful' : status === 'failed' ? 'Payment failed' : 'Checking your payment…'}</h2>
<p style="color:#aaa">Returning to Designo…</p><a style="color:#a78bfa" href="${target.replace(/"/g, '&quot;')}">Tap here if nothing happens</a></div>
<script>setTimeout(function(){location.replace(${JSON.stringify(target)})},300)</script></body></html>`);
}));

export const billingRouter = Router();

billingRouter.get('/billing/summary', ah(async (req, res) => {
  const uid = req.user!.uid;
  const [ent, balance, txns, pays] = await Promise.all([
    getEntitlements(uid), credits.getBalance(uid),
    safeQuery(db().collection(C.creditTxns), { where: [['ownerId', '==', uid]], orderBy: ['createdAt', 'desc'], limit: 50 }).then((docs) => ({ docs })),
    safeQuery(db().collection(C.payments), { where: [['ownerId', '==', uid]], orderBy: ['createdAt', 'desc'], limit: 50 }).then((docs) => ({ docs })),
  ]);
  res.json({
    plan: ent.plan, subscription: ent.sub, credits: balance,
    transactions: txns.docs.map((d) => ({ id: d.id, ...d.data() })),
    payments: pays.docs.map((d) => { const x = d.data(); return { id: d.id, status: x.status, amountPaise: x.amountPaise, description: x.description, invoiceNumber: x.invoiceNumber, method: x.method, refundStatus: x.refundStatus, createdAt: x.createdAt, paidAt: x.paidAt }; }),
  });
}));

billingRouter.get('/billing/usage', ah(async (req, res) => {
  const since = Date.now() - 30 * 86400_000;
  const s = { docs: await safeQuery(db().collection(C.creditTxns), { where: [['ownerId', '==', req.user!.uid], ['createdAt', '>=', since]], orderBy: ['createdAt', 'asc'], fallbackCap: 2000 }) };
  const byDay: Record<string, number> = {};
  for (const d of s.docs) {
    const t = d.data();
    if (t.type !== 'debit' || t.status === 'refunded') continue;
    const day = new Date(t.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + t.amount;
  }
  res.json({ usage: Object.entries(byDay).map(([day, credits]) => ({ day, credits })) });
}));

const purchase = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), planId: z.enum(['pro', 'premium', 'lifetime']), cycle: z.enum(['monthly', 'annual', 'one_time']) }),
  z.object({ kind: z.literal('pack'), packId: z.string() }),
]);

billingRouter.post('/billing/orders', paymentLimiter, validate(z.object({ purchase, coupon: z.string().max(40).optional(), client: z.enum(['app', 'web']).default('app'), mobile: z.string().max(16).optional() })), ah(async (req, res) => {
  if (zetpayEnabled) {
    // ZetPay sells fixed periods: subscriptions become one-time purchases of 30 / 365 days.
    const p = req.body.purchase;
    res.json(await createZetpayOrder(req.user!.uid, p, { coupon: req.body.coupon, client: req.body.client, mobile: req.body.mobile }));
    return;
  }
  res.json({ provider: 'razorpay', ...(await createOrder(req.user!.uid, req.body.purchase, req.body.coupon)) });
}));

/** Client polls this after returning from the payment page (server checks ZetPay; never trusts the client). */
billingRouter.get('/billing/zetpay/status/:orderId', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await checkZetpayOrder(req.params.orderId, req.user!.uid));
}));

billingRouter.post('/billing/verify', paymentLimiter, validate(z.object({
  razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string(),
})), ah(async (req, res) => {
  const r = await verifyAndFulfill(req.user!.uid, req.body.razorpay_order_id, req.body.razorpay_payment_id, req.body.razorpay_signature);
  res.json(r);
}));

billingRouter.post('/billing/subscriptions', paymentLimiter, validate(z.object({ planId: z.enum(['pro', 'premium']), cycle: z.enum(['monthly', 'annual']) })), ah(async (req, res) => {
  if (zetpayEnabled) throw new AppError(400, 'USE_ONE_TIME', 'Auto-renew is not available with UPI. Buy the plan as a one-time 30-day / 1-year purchase instead.');
  res.json(await createAutoRenewSubscription(req.user!.uid, req.body.planId, req.body.cycle));
}));

/** Client-side confirmation for subscriptions: signature check only; activation comes from the verified webhook. */
billingRouter.post('/billing/subscriptions/verify', validate(z.object({ razorpay_payment_id: z.string(), razorpay_subscription_id: z.string(), razorpay_signature: z.string() })), ah(async (req, res) => {
  if (!verifySubscriptionSignature(req.body.razorpay_payment_id, req.body.razorpay_subscription_id, req.body.razorpay_signature)) throw new AppError(400, 'PAYMENT_INVALID', 'Signature verification failed');
  res.json({ ok: true, note: 'Activation will complete when Razorpay confirms via webhook (usually seconds).' });
}));

billingRouter.post('/billing/cancel', ah(async (req, res) => { await cancelSubscription(req.user!.uid); res.json({ ok: true }); }));

/** Downgrade = schedule: current plan runs to period end, then the account moves to the chosen lower plan's purchase flow / Free. */
billingRouter.post('/billing/downgrade', validate(z.object({ toPlanId: z.enum(['free', 'pro']) })), ah(async (req, res) => {
  await db().collection(C.subscriptions).doc(req.user!.uid).set({ pendingPlanId: req.body.toPlanId, cancelAtPeriodEnd: true, updatedAt: Date.now() }, { merge: true });
  res.json({ ok: true });
}));

billingRouter.post('/billing/redeem', paymentLimiter, validate(z.object({ code: z.string().trim().min(3).max(40) })), ah(async (req, res) => {
  const uid = req.user!.uid;
  const code = req.body.code.toUpperCase();
  const ref = db().collection(C.coupons).doc(code);
  const granted = await db().runTransaction(async (tx) => {
    const c = await tx.get(ref);
    const d = c.data();
    if (!d || !d.active || d.type !== 'credits' || (d.expiresAt && d.expiresAt < Date.now()) || (d.maxRedemptions && d.redeemed >= d.maxRedemptions)) throw Errors.validation('Invalid or expired credit code');
    const r = await tx.get(ref.collection('redemptions').doc(uid));
    if (r.exists) throw Errors.validation('You have already redeemed this code');
    tx.set(ref.collection('redemptions').doc(uid), { at: Date.now() });
    tx.update(ref, { redeemed: (d.redeemed ?? 0) + 1 });
    return d.value as number;
  });
  await credits.grant(uid, granted, `Promo code ${code}`, `promo_${code}_${uid}`);
  res.json({ ok: true, credits: granted });
}));

billingRouter.get('/billing/invoices/:id', ah(async (req, res) => {
  const s = await db().collection(C.payments).doc(req.params.id).get();
  const d = s.data();
  if (!d || d.ownerId !== req.user!.uid || d.status !== 'paid') throw Errors.notFound('Invoice');
  const esc = (x: unknown) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(d.invoiceNumber)}</title><style>body{font-family:system-ui;max-width:640px;margin:40px auto;color:#111}td{padding:6px 0}h1{font-size:22px}.r{text-align:right}</style></head><body>
<h1>Designo — Invoice</h1><p>Invoice #: <b>${esc(d.invoiceNumber)}</b><br>Date: ${new Date(d.paidAt).toLocaleDateString('en-IN')}<br>Billed to: ${esc(req.user!.email)}</p>
<table style="width:100%;border-top:1px solid #ddd"><tr><td>${esc(d.description)}</td><td class="r">₹${(d.amountPaise / 100).toFixed(2)}</td></tr>${d.coupon ? `<tr><td>Coupon ${esc(d.coupon)}</td><td class="r">−₹${((d.listAmountPaise - d.amountPaise) / 100).toFixed(2)}</td></tr>` : ''}
<tr><td><b>Total paid</b></td><td class="r"><b>₹${(d.amountPaise / 100).toFixed(2)}</b></td></tr></table>
<p style="color:#666;font-size:13px">Payment ID ${esc(d.paymentId)} via ${d.provider === 'zetpay' ? 'UPI (ZetPay)' : 'Razorpay'} (${esc(d.method)}). Designo plans grant platform features and credits only; Google Stitch/Gemini usage is governed by your own Google account limits.</p></body></html>`);
}));
