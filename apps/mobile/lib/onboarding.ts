import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * First-run flow after Google sign-in:  'keys' (Stitch + Gemini API keys) → 'permissions' → 'done'.
 * Stored per account on the device.
 */
export type Step = 'keys' | 'permissions' | 'done';
const key = (uid: string) => `df.onboarding.${uid}`;
const listeners = new Set<() => void>();

export async function getStep(uid: string): Promise<Step> {
  const v = await AsyncStorage.getItem(key(uid)).catch(() => null);
  return v === 'permissions' || v === 'done' ? v : 'keys';
}
export async function setStep(uid: string, step: Step) {
  await AsyncStorage.setItem(key(uid), step).catch(() => undefined);
  listeners.forEach((l) => l());
}
export function useOnboardingStep(uid: string | undefined) {
  const [step, set] = useState<Step | null>(null);
  const load = useCallback(() => { if (uid) getStep(uid).then(set); else set(null); }, [uid]);
  useEffect(() => { load(); listeners.add(load); return () => { listeners.delete(load); }; }, [load]);
  return step;
}
