import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_KEY_ID: z.string().default('k1'),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  ENCRYPTION_KEY_PREVIOUS_ID: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(32).default(4),
  JOB_TIMEOUT_MS: z.coerce.number().int().default(300_000),
});

export const env = schema.parse(process.env);

/**
 * SECURITY: The Stitch SDK falls back to STITCH_API_KEY / STITCH_ACCESS_TOKEN from
 * process.env when no explicit credential is passed. The server must NEVER use an
 * operator-owned key for a user's request, so we strip these at boot. Every Stitch
 * call passes the requesting user's own decrypted key explicitly.
 */
export function stripAmbientProviderCredentials() {
  for (const k of ['STITCH_API_KEY', 'STITCH_ACCESS_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    delete process.env[k];
  }
}

/**
 * Production fail-fast. Firebase + encryption are mandatory. Razorpay is all-or-nothing:
 * with none of its 3 vars set the server runs with payments disabled (every billing path
 * returns 503 PAYMENTS_UNAVAILABLE and webhooks are rejected); a partial set is an error.
 */
export function checkProductionConfig(e: Record<string, unknown>): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const missing = ['FIREBASE_SERVICE_ACCOUNT_BASE64', 'ENCRYPTION_KEY'].filter((k) => !e[k]);
  const rz = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  const rzSet = rz.filter((k) => !!e[k]);
  if (rzSet.length > 0 && rzSet.length < rz.length) missing.push(...rz.filter((k) => !e[k]));
  return missing;
}

export const paymentsEnabled = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);

export function assertProductionConfig() {
  const missing = checkProductionConfig(env as Record<string, unknown>);
  if (missing.length) throw new Error(`Missing required production env: ${missing.join(', ')}`);
  if (env.NODE_ENV === 'production' && !paymentsEnabled) console.warn('[config] Razorpay not configured: payments are DISABLED (503 PAYMENTS_UNAVAILABLE).');
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
