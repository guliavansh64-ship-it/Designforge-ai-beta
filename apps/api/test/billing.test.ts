import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

let mod: typeof import('../src/services/billing.js');
beforeAll(async () => {
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'wh_secret';
  mod = await import('../src/services/billing.js');
});

const h = (s: string, d: string) => crypto.createHmac('sha256', s).update(d).digest('hex');

describe('Razorpay signature verification', () => {
  it('accepts a valid checkout signature and rejects forgeries', () => {
    expect(mod.verifyCheckoutSignature('order_1', 'pay_1', h('test_secret', 'order_1|pay_1'))).toBe(true);
    expect(mod.verifyCheckoutSignature('order_1', 'pay_2', h('test_secret', 'order_1|pay_1'))).toBe(false);
    expect(mod.verifyCheckoutSignature('order_1', 'pay_1', 'deadbeef')).toBe(false);
  });
  it('verifies subscription signatures (payment_id|subscription_id)', () => {
    expect(mod.verifySubscriptionSignature('pay_9', 'sub_9', h('test_secret', 'pay_9|sub_9'))).toBe(true);
  });
  it('verifies webhook HMAC over the raw body', () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    expect(mod.verifyWebhookSignature(body, h('wh_secret', body.toString()))).toBe(true);
    expect(mod.verifyWebhookSignature(Buffer.from(body.toString() + ' '), h('wh_secret', body.toString()))).toBe(false);
  });
});
