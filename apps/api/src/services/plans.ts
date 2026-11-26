import { DEFAULT_PLANS, type Feature, type PlanDefinition, type PlanId } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { AppError, Errors } from '../lib/errors.js';

let cache: { at: number; plans: PlanDefinition[] } | undefined;

/** Admin-editable plans live in Firestore; fall back to defaults. 60s cache. */
export async function listPlans(includeInactive = false): Promise<PlanDefinition[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const snap = await db().collection(C.plans).get();
    const stored = new Map(snap.docs.map((d) => [d.id, d.data() as PlanDefinition]));
    const merged = DEFAULT_PLANS.map((p) => ({ ...p, ...(stored.get(p.id) ?? {}) }));
    for (const [id, p] of stored) if (!merged.find((m) => m.id === id)) merged.push({ ...p, id: id as PlanId });
    cache = { at: Date.now(), plans: merged };
  }
  return includeInactive ? cache.plans : cache.plans.filter((p) => p.active);
}
export const invalidatePlans = () => { cache = undefined; };

export async function getPlan(id: string): Promise<PlanDefinition> {
  const p = (await listPlans(true)).find((x) => x.id === id);
  if (!p) throw Errors.notFound('Plan');
  return p;
}

export interface Subscription {
  ownerId: string;
  planId: PlanId;
  cycle: 'monthly' | 'annual' | 'one_time' | 'none';
  status: 'active' | 'expired' | 'cancelled' | 'pending' | 'halted';
  currentPeriodStart?: number;
  currentPeriodEnd?: number; // undefined for lifetime/free
  cancelAtPeriodEnd?: boolean;
  pendingPlanId?: PlanId;
  razorpaySubscriptionId?: string;
  updatedAt: number;
}

/**
 * Resolves the user's effective plan. Expired paid subscriptions are lazily
 * downgraded to Free here (and by the hourly sweep in jobs.ts).
 */
export async function getEntitlements(uid: string): Promise<{ plan: PlanDefinition; sub: Subscription }> {
  const ref = db().collection(C.subscriptions).doc(uid);
  const snap = await ref.get();
  let sub = snap.data() as Subscription | undefined;
  const now = Date.now();
  if (!sub) sub = { ownerId: uid, planId: 'free', cycle: 'none', status: 'active', updatedAt: now };
  if (sub.planId !== 'free' && sub.planId !== 'lifetime' && sub.currentPeriodEnd && sub.currentPeriodEnd < now && sub.status !== 'expired') {
    const nextPlan = sub.cancelAtPeriodEnd || !sub.razorpaySubscriptionId ? 'free' : sub.planId;
    if (nextPlan === 'free') {
      sub = { ...sub, status: 'expired', updatedAt: now };
      await ref.set(sub, { merge: true });
    }
  }
  const effectiveId = sub.status === 'active' || (sub.status === 'cancelled' && (sub.currentPeriodEnd ?? 0) > now) ? sub.planId : 'free';
  return { plan: await getPlan(effectiveId), sub };
}

export async function assertFeature(uid: string, feature: Feature) {
  const { plan } = await getEntitlements(uid);
  if (!plan.features.includes(feature)) throw Errors.feature(feature.replace(/_/g, ' '));
  return plan;
}

/**
 * Project-limit check. Only projects that actually contain a design count toward the plan limit.
 * Empty projects (e.g. left behind by a failed or cancelled generation) don't block creating new ones,
 * but are separately capped so the limit can't be bypassed by spamming empty projects.
 */
export const EMPTY_PROJECT_ALLOWANCE = 10;
export async function assertProjectQuota(uid: string, plan: { name: string; maxProjects: number }) {
  const snap = await db().collection(C.projects).where('ownerId', '==', uid).where('archived', '==', false).select('currentVersionId').get();
  const withDesign = snap.docs.filter((d) => !!d.get('currentVersionId')).length;
  const empty = snap.size - withDesign;
  if (withDesign >= plan.maxProjects) {
    throw new AppError(403, 'PROJECT_LIMIT_REACHED', `Your ${plan.name} plan allows ${plan.maxProjects} active projects. Archive or delete one, or upgrade.`, 'upgrade_plan');
  }
  if (empty >= EMPTY_PROJECT_ALLOWANCE) {
    throw new AppError(403, 'PROJECT_LIMIT_REACHED', `You have ${empty} empty projects. Delete some of them (Projects tab) to create new ones.`);
  }
}
