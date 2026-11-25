import { initializeApp, getApps } from 'firebase/app';
// getReactNativePersistence is exported by the RN build of firebase/auth.
// @ts-expect-error — not present in the web typings that TypeScript resolves
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getAuth, type Auth } from 'firebase/auth';
import { secureStorage } from './secureStorage';

const cfg = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId);

let auth: Auth | undefined;
export function fbAuth(): Auth {
  if (auth) return auth;
  if (!firebaseConfigured) throw new Error('Firebase is not configured (EXPO_PUBLIC_FIREBASE_*).');
  const existing = getApps()[0];
  const app = existing ?? initializeApp(cfg);
  auth = existing ? getAuth(app) : (initializeAuth(app, { persistence: getReactNativePersistence(secureStorage) }) as Auth);
  return auth;
}
