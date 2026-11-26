import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeFirestore.js';

vi.hoisted(() => {
  process.env.ZETPAY_API_KEY = 'ZPtest_key_0123456789abcdef';
  process.env.PUBLIC_API_URL = 'https://api.designforge.test';
});
const fake = createFakeDb();
vi.mock('../src/lib/firebase.js', () => ({ db: () => fake.db, C: { payments: 'payments' } }));
const fulfillOrder = vi.fn(async () => ({ ok: true }));
vi.mock('../src/services/billing.js', () => ({
  price: async (p: any) => (p.kind === 'pack' ? { amountPaise: 14900, credits: 100, description: '100 credit pack' } : { amountPaise: 1499900, credits: 6000, description: 'Lifetime' }),
  applyCoupon: async (_c: any, _u: any, priced: any) => ({ amountPaise: priced.amountPaise, coupon: undefined }),
  fulfillOrder: (...a: unknown[]) => fulfillOrder(...(a as [])),
}));
vi.mock('../src/services/notify.js', () => ({ notify: vi.fn(async () => undefined) }));

let zet: typeof import('../src/services/zetpay.js');
const calls: { url: string; init?: RequestInit }[] = [];
let statusReply: any = { success: true, data: { status: 'pending' } };
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/create-order')) return new Response(JSON.stringify({ success: true, data: { order_id: 'ZP_ORDER_1', payment_url: 'https://zetpay.test/pay/ZP_ORDER_1', amount: 149, mode: 'test' } }), { status: 200 });
    return new Response(JSON.stringify(statusReply), { status: 200 });
  }));
  zet = await import('../src/services/zetpay.js');
});
beforeEach(() => { calls.length = 0; fulfillOrder.mockClear(); });

describe('ZetPay', () => {
  it('creates an order priced on the server, with the key in a header and our return URL', async () => {
    const r = await zet.createZetpayOrder('u1', { kind: 'pack', packId: 'pack_100' }, { client: 'app' });
    expect(r).toMatchObject({ provider: 'zetpay', orderId: 'ZP_ORDER_1', paymentUrl: 'https://zetpay.test/pay/ZP_ORDER_1' });
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.amount).toBe(149);
    expect(body.redirect_url).toBe('https://api.designforge.test/api/billing/zetpay/return/app');
    expect((calls[0].init!.headers as any)['X-ZetAPI-Key']).toBe('ZPtest_key_0123456789abcdef');
    const doc = (await fake.db.collection('payments').doc('ZP_ORDER_1').get()).data()!;
    expect(doc).toMatchObject({ ownerId: 'u1', provider: 'zetpay', amountPaise: 14900, status: 'created' });
  });

  it('rejects amounts above ₹5000 without calling ZetPay', async () => {
    await expect(zet.createZetpayOrder('u1', { kind: 'plan', planId: 'lifetime', cycle: 'one_time' }, { client: 'app' })).rejects.toMatchObject({ code: 'AMOUNT_TOO_HIGH' });
    expect(calls).toHaveLength(0);
  });

  it('never fulfils while pending; fulfils exactly when the server-side status says success', async () => {
    statusReply = { success: true, data: { status: 'pending' } };
    expect((await zet.checkZetpayOrder('ZP_ORDER_1', 'u1')).status).toBe('pending');
    expect(fulfillOrder).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 4100)); // per-order status cache
    statusReply = { success: true, data: { status: 'success', amount: 149 } };
    expect((await zet.checkZetpayOrder('ZP_ORDER_1', 'u1')).status).toBe('paid');
    expect(fulfillOrder).toHaveBeenCalledWith('ZP_ORDER_1', 'ZP_ORDER_1', 'upi');
  }, 10_000);

  it('other users cannot poll someone else\'s order', async () => {
    await expect(zet.checkZetpayOrder('ZP_ORDER_1', 'intruder')).rejects.toMatchObject({ status: 404 });
  });

  it('an amount mismatch reported by ZetPay is never fulfilled', async () => {
    await fake.db.collection('payments').doc('ZP_ORDER_2').set({ ownerId: 'u1', provider: 'zetpay', status: 'created', amountPaise: 14900, description: 'x', credits: 100 });
    statusReply = { success: true, data: { status: 'success', amount: 1 } };
    await expect(zet.checkZetpayOrder('ZP_ORDER_2', 'u1')).rejects.toMatchObject({ code: 'PAYMENT_INVALID' });
    expect(fulfillOrder).not.toHaveBeenCalled();
  });
});
