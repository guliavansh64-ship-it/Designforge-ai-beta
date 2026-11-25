import { Router } from 'express';
import { ah } from '../middleware/validate.js';
import { getBlob } from '../services/blobs.js';
import { auth } from '../lib/firebase.js';

/**
 * Asset delivery. <img> tags cannot send Authorization headers, so the web/app pass a
 * short-lived Firebase ID token as ?t= (validated identically). Public assets (templates) need none.
 */
export const assetsRouter = Router();
assetsRouter.get('/assets/:id', ah(async (req, res) => {
  let uid: string | undefined;
  const token = (req.query.t as string) || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  if (token) { try { uid = (await auth().verifyIdToken(token)).uid; } catch { uid = undefined; } }
  const b = await getBlob(req.params.id, uid, true);
  if ('redirect' in b) return res.redirect(302, b.redirect);
  res.setHeader('content-type', b.mime);
  res.setHeader('cache-control', 'private, max-age=86400');
  res.setHeader('x-content-type-options', 'nosniff');
  if (b.mime === 'image/svg+xml' || b.mime === 'text/html') res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.send(b.data);
}));
