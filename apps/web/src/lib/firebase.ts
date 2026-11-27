import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);
export const uiPreview = import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === '1';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
export function fbAuth(): Auth {
  if (!firebaseConfigured) throw new Error('Firebase is not configured. Set VITE_FIREBASE_* variables.');
  app ??= initializeApp(cfg);
  auth ??= getAuth(app);
  return auth;
}

/** Designo login only requests basic profile scopes. Stitch access is a SEPARATE step (Integrations). */
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
