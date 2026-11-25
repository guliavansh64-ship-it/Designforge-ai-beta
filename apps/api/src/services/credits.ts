import { CREDIT_COSTS, type CreditOperation } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { Errors } from '../lib/errors.js';
import { getEntitlements } from './plans.js';

/**
 * Credit ledger.
 *  credit_wallets/{uid}          { balance, periodKey, lifetimeGranted, lifetimeSpent, updatedAt }
 *  credit_transactions/{txnId}   { ownerId, type, amount, status, reason, ref, createdAt }
 *
 * - Every debit uses a caller-supplied idempotency key as the document id, inside a
 *   Firestore transaction → the same operation can never be charged twice.
 * - Flow: reserve() before calling Stitch → commit() on success | refund() on failure.
 * - Grants (payments, promos, admin) are also idempotent by `ref`.
 */

export type TxnStatus = 'reserved' | 'committed' | 'refunded' | 'granted';

const walletRef = (uid: string) => db().collection(C.wallets).doc(uid);
const txnRef = (id: string) => db().collection(C.creditTxns).doc(id);
const periodKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Monthly allowance top-up for subscription/free plans (not cumulative: tops up to allowance). */
export async function ensureMonthlyAllowance(uid: string) {
  const { plan, sub } = await getEntitlements(uid);
  const allowance = sub.cycle === 'annual' ? Math.round(plan.annualCredits / 12) : plan.monthlyCredits;
  const pk = periodKey();
  await db().runTransaction(async (tx) => {
    const w = await tx.get(walletRef(uid));
    const data = w.data() ?? { balance: 0, lifetimeGranted: 0, lifetimeSpent: 0 };
    if (data.periodKey === pk) return;
    const topUp = Math.max(0, allowance - (data.allowanceRemaining ?? 0));
    const id = `allowance_${uid}_${pk}`;
    const t = await tx.get(txnRef(id));
    if (t.exists) { tx.set(walletRef(uid), { periodKey: pk }, { merge: true }); return; }
    tx.set(walletRef(uid), {
      ownerId: uid,
      balance: (data.balance ?? 0) + topUp,
      allowanceRemaining: allowance,
      lifetimeGranted: (data.lifetimeGranted ?? 0) + topUp,
      periodKey: pk,
      updatedAt: Date.now(),
    }, { merge: true });
    if (topUp > 0) tx.set(txnRef(id), { ownerId: uid, type: 'grant', amount: topUp, status: 'granted', reason: `Monthly ${plan.name} allowance`, ref: id, createdAt: Date.now() });
  });
}

export async function getBalance(uid: string): Promise<number> {
  await ensureMonthlyAllowance(uid);
  return (await walletRef(uid).get()).get('balance') ?? 0;
}

export function costOf(op: CreditOperation, multiplier = 1) {
  return CREDIT_COSTS[op] * multiplier;
}

export async function reserve(uid: string, op: CreditOperation, idempotencyKey: string, multiplier = 1, meta: Record<string, unknown> = {}) {
  await ensureMonthlyAllowance(uid);
  const amount = costOf(op, multiplier);
  const id = `debit_${uid}_${idempotencyKey}`.slice(0, 1400);
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(txnRef(id));
    if (existing.exists) return { txnId: id, amount: existing.get('amount') as number, duplicate: true };
    const w = await tx.get(walletRef(uid));
    const balance = (w.get('balance') as number) ?? 0;
    if (balance < amount) throw Errors.credits(amount, balance);
    tx.set(walletRef(uid), {
      balance: balance - amount,
      allowanceRemaining: Math.max(0, ((w.get('allowanceRemaining') as number) ?? 0) - amount),
      lifetimeSpent: ((w.get('lifetimeSpent') as number) ?? 0) + amount,
      updatedAt: Date.now(),
    }, { merge: true });
    tx.set(txnRef(id), { ownerId: uid, type: 'debit', op, amount, status: 'reserved', meta, createdAt: Date.now() });
    return { txnId: id, amount, duplicate: false };
  });
}

export async function commit(txnId: string) {
  await txnRef(txnId).update({ status: 'committed', committedAt: Date.now() });
}

/** Refund a reserved/committed debit exactly once. Returns true if credits were returned. */
export async function refund(txnId: string, reason: string): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const t = await tx.get(txnRef(txnId));
    if (!t.exists) return false;
    const d = t.data()!;
    if (d.type !== 'debit' || d.status === 'refunded') return false;
    const w = await tx.get(walletRef(d.ownerId));
    tx.set(walletRef(d.ownerId), {
      balance: ((w.get('balance') as number) ?? 0) + d.amount,
      lifetimeSpent: Math.max(0, ((w.get('lifetimeSpent') as number) ?? 0) - d.amount),
      updatedAt: Date.now(),
    }, { merge: true });
    tx.update(txnRef(txnId), { status: 'refunded', refundReason: reason, refundedAt: Date.now() });
    return true;
  });
}

/** Idempotent grant (payments, promos, admin adjustments — negative amounts allowed for admin). */
export async function grant(uid: string, amount: number, reason: string, ref: string, meta: Record<string, unknown> = {}) {
  const id = `grant_${ref}`.slice(0, 1400);
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(txnRef(id));
    if (existing.exists) return { txnId: id, duplicate: true };
    const w = await tx.get(walletRef(uid));
    const balance = ((w.get('balance') as number) ?? 0) + amount;
    if (balance < 0) throw Errors.validation('Adjustment would make balance negative');
    tx.set(walletRef(uid), {
      ownerId: uid, balance,
      lifetimeGranted: ((w.get('lifetimeGranted') as number) ?? 0) + Math.max(0, amount),
      updatedAt: Date.now(),
    }, { merge: true });
    tx.set(txnRef(id), { ownerId: uid, type: amount >= 0 ? 'grant' : 'adjustment', amount, status: 'granted', reason, ref, meta, createdAt: Date.now() });
    return { txnId: id, duplicate: false };
  });
}
