import { db, C } from '../lib/firebase.js';

export interface SystemSettings {
  platformName: string;
  logoUrl?: string;
  primaryColor: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  supportEmail: string;
  supportUrl?: string;
  termsUrl?: string;
  privacyUrl?: string;
  featureFlags: Record<string, boolean>;
  limits: { maxPromptChars: number; maxUploadBytes: number; maxProjectsFree: number };
}

export const DEFAULT_SETTINGS: SystemSettings = {
  platformName: 'DesignForge AI',
  primaryColor: '#7C5CFF',
  maintenanceMode: false,
  supportEmail: 'support@designforge.app',
  featureFlags: { logoStudio: true, chatAssistant: true, autoImprove: true, sharing: true, reactExport: true },
  limits: { maxPromptChars: 4000, maxUploadBytes: 5 * 1024 * 1024, maxProjectsFree: 5 },
};

let cache: { at: number; value: SystemSettings } | undefined;

/** 30s in-memory cache keeps Firestore reads low on the free tier. */
export async function getSystemSettings(): Promise<SystemSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  try {
    const snap = await db().collection(C.settings).doc('global').get();
    const value = { ...DEFAULT_SETTINGS, ...(snap.exists ? (snap.data() as Partial<SystemSettings>) : {}) };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? DEFAULT_SETTINGS;
  }
}

export function invalidateSettingsCache() {
  cache = undefined;
}
