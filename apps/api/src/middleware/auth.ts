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

/** Verifies the Firebase ID token (checkRevoked=true so logout-everywhere / suspension is honoured). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw Errors.unauth();
    let decoded;
    try {
      decoded = await auth().verifyIdToken(token, true);
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

    const userSnap = await db().collection(C.users).doc(decoded.uid).get();
    if (userSnap.exists && userSnap.get('status') === 'suspended') {
      throw new AppError(403, ERROR_CODES.SUSPENDED, 'This account is suspended. Contact support.');
    }
    const settings = await getSystemSettings();
    if (settings.maintenanceMode && !req.user.adminRole) {
      throw new AppError(503, ERROR_CODES.MAINTENANCE, settings.maintenanceMessage || 'DesignForge is under maintenance.');
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
