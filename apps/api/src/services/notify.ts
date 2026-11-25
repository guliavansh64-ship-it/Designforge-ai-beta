import { db, C } from '../lib/firebase.js';
import { logger } from '../lib/logger.js';

export type NotificationType =
  | 'generation_completed' | 'generation_failed' | 'credits_low' | 'subscription_renewed'
  | 'subscription_expiring' | 'subscription_expired' | 'payment_success' | 'payment_failed'
  | 'announcement' | 'support_reply';

/**
 * In-app notification + Android push via Expo Push Service (no server secret needed;
 * tokens are opaque Expo push tokens the app registers after the user grants permission).
 */
export async function notify(uid: string, type: NotificationType, title: string, body: string, data: Record<string, string> = {}) {
  await db().collection(C.notifications).add({ ownerId: uid, type, title, body, data, read: false, createdAt: Date.now() });
  try {
    const user = await db().collection(C.users).doc(uid).get();
    const tokens: string[] = (user.get('expoPushTokens') ?? []).filter((t: string) => /^ExponentPushToken\[/.test(t));
    const prefs = user.get('notificationPrefs') ?? {};
    if (!tokens.length || prefs.push === false) return;
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data: { type, ...data }, sound: 'default', channelId: 'default' }))),
    });
    if (!r.ok) logger.warn({ status: r.status }, 'expo push failed');
  } catch (e) {
    logger.warn({ err: e }, 'push delivery error');
  }
}

/** Cheap daily analytics counters (1 write per event, no scans). */
export async function track(metric: string, n = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const { FieldValue } = await import('../lib/firebase.js');
  await db().collection('analytics_daily').doc(day).set({ [metric]: FieldValue.increment(n), day }, { merge: true }).catch(() => undefined);
}

export async function adminAudit(actorUid: string, action: string, target: string, details: Record<string, unknown> = {}) {
  await db().collection(C.audit).add({ actorUid, action, target, details, at: Date.now() });
}
