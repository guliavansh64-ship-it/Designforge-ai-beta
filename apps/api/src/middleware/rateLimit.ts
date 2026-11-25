import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@designforge/shared';

const handler = (_req: any, res: any) =>
  res.status(429).json({ error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests. Slow down a little.' } });

const keyByUser = (req: any) => req.user?.uid ?? req.ip;

export const globalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, handler });
export const generationLimiter = rateLimit({ windowMs: 60_000, limit: 12, keyGenerator: keyByUser, handler });
export const connectLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, keyGenerator: keyByUser, handler });
export const paymentLimiter = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: keyByUser, handler });
