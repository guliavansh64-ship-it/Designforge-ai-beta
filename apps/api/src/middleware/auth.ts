import type { NextFunction, Request, Response } from 'express';
import { auth, db, C } from '../lib/firebase.js';
import { AppError, Errors } from '../lib/errors.js';
import { ERROR_CODES } from '@designforge/shared';
import { getSystemSettings } from '../services/settings.js';

export type AdminRole = 'owner' | 'admin' | 'support' | 'finance';

export interface AuthedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  adminRole?: AdminRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/**
 * PERF: verifying with checkRevoked=true costs a network round-trip to Firebase Auth on EVERY request,
 * and the suspension check costs a Firestore read. Both are cached per uid for a short window:
 *  - signature/expiry are still verified locally on every request;
 *  - revocation is re-checked at least every REVOKE_TTL (and immediately after an admin action on this server);
 *  - account status is re-read at least every STATUS_TTL.
 */
const REVOKE_TTL = 5 * 60_000;
const STATUS_TTL = 60_000;
const revokeCheckedAt = new Map<string, number>();
const statusCache = new Map<string, { suspended: boolean; at: number }>();
/** Call after suspending/reactivating a user or revoking their sessions. */
export function invalidateAuthCache(uid: string) { revokeCheckedAt.delete(uid); statusCache.delete(uid); }

/** Verifies the Firebase ID token (revocation honoured, cached briefly; see above). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw Errors.unauth();
    let decoded;
    try {
      decoded = await auth().verifyIdToken(token, false);
      const last = revokeCheckedAt.get(decoded.uid) ?? 0;
      if (Date.now() - last > REVOKE_TTL) {
        decoded = await auth().verifyIdToken(token, true);
        if (revokeCheckedAt.size > 5000) revokeCheckedAt.clear();
        revokeCheckedAt.set(decoded.uid, Date.now());
      }
    } catch (e: any) {
      if (e?.code === 'auth/id-token-revoked') throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Session revoked. Please sign in again.');
      if (e?.code === 'auth/id-token-expired') throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Session expired. Please sign in again.');
      throw Errors.unauth('Invalid session');
    }
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      adminRole: decoded.adminRole as AdminRole | undefined,
    };

    let st = statusCache.get(decoded.uid);
    if (!st || Date.now() - st.at > STATUS_TTL) {
      const userSnap = await db().collection(C.users).doc(decoded.uid).get();
      st = { suspended: userSnap.exists && userSnap.get('status') === 'suspended', at: Date.now() };
      if (statusCache.size > 5000) statusCache.clear();
      statusCache.set(decoded.uid, st);
    }
    if (st.suspended) {
      throw new AppError(403, ERROR_CODES.SUSPENDED, 'This account is suspended. Contact support.');
    }
    const settings = await getSystemSettings();
    if (settings.maintenanceMode && !req.user.adminRole) {
      throw new AppError(503, ERROR_CODES.MAINTENANCE, settings.maintenanceMessage || 'Designo is under maintenance.');
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Admin authorization uses a Firebase custom claim `adminRole` set ONLY via the
 * `npm run make-admin` script (Admin SDK). There is no public admin sign-up.
 * We additionally require a matching active `admin_users` doc so a role can be
 * revoked instantly without waiting for token expiry.
 */
export function requireAdmin(...roles: AdminRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const role = req.user?.adminRole;
      if (!role) throw Errors.forbidden('Admin access required');
      const adminDoc = await db().collection(C.adminUsers).doc(req.user!.uid).get();
      if (!adminDoc.exists || adminDoc.get('active') !== true) throw Errors.forbidden('Admin access revoked');
      if (roles.length && role !== 'owner' && !roles.includes(role)) throw Errors.forbidden(`Requires role: ${roles.join(' or ')}`);
      next();
    } catch (e) {
      next(e);
    }
  };
}
