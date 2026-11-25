import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { ERROR_CODES } from '@designforge/shared';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, action: err.action } });
  }
  if ((err as any)?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Payload too large' } });
  }
  logger.error({ err, path: req.path, uid: req.user?.uid }, 'unhandled error');
  res.status(500).json({ error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Please try again.' } });
}
