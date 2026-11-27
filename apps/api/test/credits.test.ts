import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeFirestore.js';

const fake = createFakeDb();
vi.mock('../src/lib/firebase.js', () => ({ db: () => fake.db, C: { wallets: 'credit_wallets', creditTxns: 'credit_transactions' } }));
vi.mock('../src/services/plans.js', () => ({
  getEntitlements: async () => ({ plan: { name: 'Free', monthlyCredits: 40, annualCredits: 480 }, sub: { cycle: 'none' } }),
}));
const credits = await import('../src/services/credits.js');

describe('credit ledger', () => {
  beforeEach(() => fake.store.clear());

  it('grants the monthly allowance once per period', async () => {
    expect(await credits.getBalance('u1')).toBe(40);
    expect(await credits.getBalance('u1')).toBe(40);
  });
  it('never deducts twice for the same idempotency key — even concurrently', async () => {
    await credits.getBalance('u1');
    const results = await Promise.all(Array.from({ length: 5 }, () => credits.reserve('u1', 'generate_flash', 'same-key')));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await credits.getBalance('u1')).toBe(35);
  });
  it('refunds exactly once', async () => {
    const r = await credits.reserve('u1', 'generate_pro', 'k-refund');
    expect(await credits.getBalance('u1')).toBe(35);
    expect(await credits.refund(r.txnId, 'failed')).toBe(true);
    expect(await credits.refund(r.txnId, 'failed again')).toBe(false);
    expect(await credits.getBalance('u1')).toBe(40);
  });
  it('rejects when balance is insufficient', async () => {
    await expect(credits.reserve('u2', 'generate_pro', 'big', 100)).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });
  it('payment grants are idempotent by order reference', async () => {
    await credits.getBalance('u3');
    await credits.grant('u3', 400, 'Pro monthly', 'order_abc');
    await credits.grant('u3', 400, 'Pro monthly (webhook replay)', 'order_abc');
    expect(await credits.getBalance('u3')).toBe(440);
  });
  it('isolates users', async () => {
    await credits.reserve('uA', 'edit', 'k1');
    expect(await credits.getBalance('uB')).toBe(40);
  });
});
