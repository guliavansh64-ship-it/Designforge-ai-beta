import crypto from 'node:crypto';

/**
 * AES-256-GCM envelope for user-owned provider credentials.
 * Format: v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>
 * The uid is bound as Additional Authenticated Data, so a ciphertext copied into
 * another user's document fails to decrypt (prevents cross-user credential reuse).
 */
export class CredentialVault {
  private keys = new Map<string, Buffer>();
  /**
   * @param base64Key   current key (all new encryptions use it)
   * @param keyId       id stamped into each envelope
   * @param previous    optional older keys kept ONLY for decryption during a rotation window
   */
  constructor(base64Key: string, private keyId = 'k1', previous: { id: string; key: string }[] = []) {
    for (const [id, k] of [[keyId, base64Key], ...previous.map((p) => [p.id, p.key])] as [string, string][]) {
      const buf = Buffer.from(k, 'base64');
      if (buf.length !== 32) throw new Error(`Encryption key "${id}" must decode to exactly 32 bytes`);
      if (this.keys.has(id)) throw new Error(`Duplicate encryption key id "${id}"`);
      this.keys.set(id, buf);
    }
  }

  get currentKeyId() { return this.keyId; }

  encrypt(plaintext: string, uid: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys.get(this.keyId)!, iv);
    cipher.setAAD(Buffer.from(`uid:${uid}`));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', this.keyId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  /** True if the envelope was sealed with an older key and should be re-encrypted. */
  needsRotation(payload: string) { return payload.split(':')[1] !== this.keyId; }

  decrypt(payload: string, uid: string): string {
    const [v, id, ivB, tagB, ctB] = payload.split(':');
    if (v !== 'v1' || !ivB || !tagB || !ctB) throw new VaultError('Unsupported credential envelope');
    const key = this.keys.get(id);
    if (!key) throw new VaultError(`Credential was encrypted with unknown key id "${id}"`);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
      decipher.setAAD(Buffer.from(`uid:${uid}`));
      decipher.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new VaultError('Credential failed authentication (wrong key or tampered/copied ciphertext)');
    }
  }
}

export class VaultError extends Error {}

export const keyHint = (secret: string) => (secret.length >= 4 ? `…${secret.slice(-4)}` : '…');

export function hmacSha256Hex(secret: string, data: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const newId = (prefix = '') => prefix + crypto.randomBytes(10).toString('hex');
