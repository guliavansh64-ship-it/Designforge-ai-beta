import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { CredentialVault, VaultError, hmacSha256Hex, keyHint, safeEqualHex } from '../src/lib/crypto.js';

const key = crypto.randomBytes(32).toString('base64');

describe('CredentialVault (AES-256-GCM, uid-bound)', () => {
  const v = new CredentialVault(key);
  it('round-trips a user key', () => {
    const enc = v.encrypt('AIzaSy-user-own-stitch-key-1234', 'uidA');
    expect(enc).not.toContain('AIzaSy');
    expect(v.decrypt(enc, 'uidA')).toBe('AIzaSy-user-own-stitch-key-1234');
  });
  it('uses a fresh IV each time', () => {
    expect(v.encrypt('same', 'u')).not.toBe(v.encrypt('same', 'u'));
  });
  it("refuses to decrypt another user's ciphertext (AAD binding)", () => {
    const enc = v.encrypt('secret', 'uidA');
    expect(() => v.decrypt(enc, 'uidB')).toThrow();
  });
  it('detects tampering', () => {
    const enc = v.encrypt('secret', 'u').split(':');
    enc[4] = Buffer.from('tampered').toString('base64');
    expect(() => v.decrypt(enc.join(':'), 'u')).toThrow();
  });
  it('decrypts envelopes from a previous key during rotation and flags them', () => {
    const oldV = new CredentialVault(key, 'k1');
    const sealed = oldV.encrypt('AQ.old-secret', 'u1');
    const k2 = crypto.randomBytes(32).toString('base64');
    const rotated = new CredentialVault(k2, 'k2', [{ id: 'k1', key }]);
    expect(rotated.decrypt(sealed, 'u1')).toBe('AQ.old-secret');
    expect(rotated.needsRotation(sealed)).toBe(true);
    const resealed = rotated.encrypt('AQ.old-secret', 'u1');
    expect(resealed.split(':')[1]).toBe('k2');
    expect(rotated.needsRotation(resealed)).toBe(false);
    expect(() => new CredentialVault(k2, 'k2').decrypt(sealed, 'u1')).toThrow(VaultError);
  });
  it('rejects short keys', () => expect(() => new CredentialVault(Buffer.alloc(16).toString('base64'))).toThrow());
  it('hints only last 4 chars', () => expect(keyHint('abcdefgh1234')).toBe('…1234'));
  it('constant-time compare works', () => {
    const h = hmacSha256Hex('s', 'd');
    expect(safeEqualHex(h, hmacSha256Hex('s', 'd'))).toBe(true);
    expect(safeEqualHex(h, hmacSha256Hex('s', 'x'))).toBe(false);
  });
});
