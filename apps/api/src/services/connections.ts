import type { ConnectionStatus, Provider } from '@designforge/shared';
import { CredentialVault, VaultError, keyHint } from '../lib/crypto.js';
import { db, C, FieldValue } from '../lib/firebase.js';
import { env } from '../config.js';
import { Errors } from '../lib/errors.js';

let vault: CredentialVault | undefined;
export function getVault(): CredentialVault {
  if (!vault) {
    if (!env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not configured');
    const previous = env.ENCRYPTION_KEY_PREVIOUS && env.ENCRYPTION_KEY_PREVIOUS_ID
      ? [{ id: env.ENCRYPTION_KEY_PREVIOUS_ID, key: env.ENCRYPTION_KEY_PREVIOUS }] : [];
    vault = new CredentialVault(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_ID, previous);
  }
  return vault;
}

/**
 * Document layout: user_connections/{uid}_{provider}
 *   { ownerId, provider, encryptedKey, keyHint, status, lastVerifiedAt, lastError, createdAt }
 * `encryptedKey` is NEVER returned to any client (rules deny client reads of this collection).
 */
const docId = (uid: string, p: Provider) => `${uid}_${p}`;

export async function saveCredential(uid: string, provider: Provider, secret: string) {
  const enc = getVault().encrypt(secret, uid);
  await db().collection(C.connections).doc(docId(uid, provider)).set({
    ownerId: uid,
    provider,
    encryptedKey: enc,
    keyHint: keyHint(secret),
    status: 'active',
    lastVerifiedAt: Date.now(),
    lastError: FieldValue.delete(),
    createdAt: Date.now(),
  }, { merge: true });
}

/** Returns the decrypted user-owned key or throws a "connect first" error. Never falls back to any other key. */
export async function getCredential(uid: string, provider: Provider): Promise<string> {
  const snap = await db().collection(C.connections).doc(docId(uid, provider)).get();
  const data = snap.data();
  if (!snap.exists || !data?.encryptedKey || data.ownerId !== uid) {
    throw provider === 'stitch' ? Errors.stitchNotConnected() : Errors.geminiNotConnected();
  }
  if (data.status === 'revoked') throw provider === 'stitch' ? Errors.stitchNotConnected() : Errors.geminiNotConnected();
  const v = getVault();
  let secret: string;
  try {
    secret = v.decrypt(data.encryptedKey, uid);
  } catch (e) {
    if (!(e instanceof VaultError)) throw e;
    // Key rotated without a decrypt window, or record tampered with: never guess, ask the user to reconnect.
    await markConnection(uid, provider, 'invalid', 'Stored key can no longer be decrypted. Please reconnect.');
    throw provider === 'stitch' ? Errors.stitchNotConnected() : Errors.geminiNotConnected();
  }
  if (v.needsRotation(data.encryptedKey)) {
    // Lazy re-encryption with the current key (best effort; a failure here must not block the request).
    await db().collection(C.connections).doc(docId(uid, provider)).update({ encryptedKey: v.encrypt(secret, uid) }).catch(() => undefined);
  }
  return secret;
}

export async function markConnection(uid: string, provider: Provider, status: ConnectionStatus['status'], lastError?: string) {
  await db().collection(C.connections).doc(docId(uid, provider)).set(
    { status, lastError: lastError ?? FieldValue.delete(), lastVerifiedAt: Date.now() },
    { merge: true },
  );
}

export async function deleteCredential(uid: string, provider: Provider) {
  await db().collection(C.connections).doc(docId(uid, provider)).delete();
}

export async function listConnectionStatus(uid: string): Promise<ConnectionStatus[]> {
  const providers: Provider[] = ['stitch', 'gemini'];
  const snaps = await Promise.all(providers.map((p) => db().collection(C.connections).doc(docId(uid, p)).get()));
  return snaps.map((s, i) => {
    const d = s.data();
    if (!s.exists || !d) return { provider: providers[i], connected: false, status: 'not_connected' as const };
    return {
      provider: providers[i],
      connected: d.status === 'active',
      keyHint: d.keyHint,
      status: d.status,
      lastVerifiedAt: d.lastVerifiedAt,
      lastError: d.lastError,
    };
  });
}
