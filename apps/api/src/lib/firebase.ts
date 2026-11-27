import admin from 'firebase-admin';
import { env } from '../config.js';

let app: admin.app.App | undefined;

export function firebase(): admin.app.App {
  if (app) return app;
  if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    app = admin.initializeApp({ credential: admin.credential.cert(json), projectId: json.project_id });
  } else {
    // Application Default Credentials (e.g. Cloud Run) or Firestore emulator (FIRESTORE_EMULATOR_HOST)
    app = admin.initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  }
  return app;
}

let fs: admin.firestore.Firestore | undefined;
/** Firestore with `ignoreUndefinedProperties`, so an optional field that is undefined can never crash a job. */
export const db = () => {
  if (fs) return fs;
  fs = firebase().firestore();
  try { fs.settings({ ignoreUndefinedProperties: true }); } catch { /* settings already applied */ }
  return fs;
};
export const auth = () => firebase().auth();
export const messaging = () => firebase().messaging();
export const FieldValue = admin.firestore.FieldValue;
export type Tx = admin.firestore.Transaction;

export const C = {
  users: 'users',
  connections: 'user_connections',
  prefs: 'user_preferences',
  projects: 'projects',
  versions: 'project_versions',
  assets: 'project_assets',
  generations: 'generations',
  jobs: 'generation_jobs',
  wallets: 'credit_wallets',
  creditTxns: 'credit_transactions',
  plans: 'subscription_plans',
  subscriptions: 'subscriptions',
  payments: 'payments',
  coupons: 'coupons',
  notifications: 'notifications',
  tickets: 'support_tickets',
  templates: 'templates',
  announcements: 'announcements',
  adminUsers: 'admin_users',
  audit: 'admin_audit_logs',
  settings: 'system_settings',
  webhookEvents: 'webhook_events',
  chat: 'chat_messages',
} as const;
