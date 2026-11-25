import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { Errors } from '../lib/errors.js';

export const validate =
  (schema: ZodSchema, where: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[where]);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.') || where}: ${i.message}`).join('; ');
      return next(Errors.validation(msg));
    }
    (req as any)[where] = parsed.data;
    next();
  };

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
