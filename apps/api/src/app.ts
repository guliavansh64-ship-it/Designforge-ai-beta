import { STITCH_MODELS } from '@designforge/shared';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env } from './config.js';
import { logger } from './lib/logger.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { ah } from './middleware/validate.js';
import { meRouter } from './routes/me.js';
import { connectionsRouter } from './routes/connections.js';
import { projectsRouter } from './routes/projects.js';
import { generateRouter } from './routes/generate.js';
import { chatRouter } from './routes/chat.js';
import { exportsRouter } from './routes/exports.js';
import { billingPublicRouter, billingRouter } from './routes/billing.js';
import { supportPublicRouter, supportRouter } from './routes/support.js';
import { templatesPublicRouter, templatesRouter } from './routes/templates.js';
import { assetsRouter } from './routes/assets.js';
import { adminRouter } from './routes/admin.js';
import { handleWebhook } from './services/billing.js';

/** Bump when a deploy must be distinguishable from older ones (shown on /health). */
export const API_BUILD = '2026-12-08';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // JSON API only
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // assets are loaded by the web app origin
  }));
  app.use(cors({
    origin: (origin, cb) => (!origin || corsOrigins.includes(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed'))),
    credentials: false, // bearer tokens, no cookies → CSRF is not applicable to this API
    exposedHeaders: ['x-export-report', 'content-disposition'],
  }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // Razorpay webhook needs the RAW body for HMAC verification → mounted before express.json.
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
    const r = await handleWebhook(req.body as Buffer, String(req.headers['x-razorpay-signature'] ?? ''), req.headers['x-razorpay-event-id'] as string | undefined);
    res.json({ ok: true, ...r });
  }));

  app.use(express.json({ limit: '8mb' }));
  app.use(globalLimiter);

  // `build` lets you verify a deployment is current: it must say 2026-11-26 (Stitch SDK 0.4 + download_file + index fallback + auth cache).
  app.get('/health', (_req, res) => res.json({ ok: true, env: env.NODE_ENV, build: API_BUILD, stitchModels: STITCH_MODELS.map((m) => m.id), time: new Date().toISOString() }));

  // Public
  app.use('/api', billingPublicRouter, supportPublicRouter, templatesPublicRouter, assetsRouter);
  // Authenticated
  app.use('/api', requireAuth, meRouter, connectionsRouter, projectsRouter, generateRouter, chatRouter, exportsRouter, billingRouter, supportRouter, templatesRouter);
  app.use('/api/admin', requireAuth, adminRouter);

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}
