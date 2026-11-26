import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, onIdTokenChanged, signInWithCredential, signOut, type User } from 'firebase/auth';
import { fbAuth, firebaseConfigured } from './firebase';
import { api, ApiError, clearApiCache, loadApiUrlOverride } from './api';
import { registerForPush, unregisterPush } from './push';
import type { Me } from './types';

interface Ctx { user: User | null; me: Me | null; loading: boolean; error: string | null; signIn: () => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

// Native Google Sign-In → Google ID token → Firebase credential. Only basic profile scopes.
// This does NOT authorize Stitch — that is a separate step in Integrations.
GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, scopes: ['profile', 'email'] });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/me')); setError(null); }
    catch (e) {
      const err = e as ApiError; setError(err.message);
      if (err.code === 'ACCOUNT_SUSPENDED' || err.status === 401) { setMe(null); await signOut(fbAuth()).catch(() => undefined); }
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); setError('App is not configured (Firebase env missing).'); return; }
    let unsub: (() => void) | undefined; let alive = true;
    // Load a saved test-server URL (test builds only) BEFORE the first /me call.
    loadApiUrlOverride().finally(() => {
      if (!alive) return;
      unsub = onIdTokenChanged(fbAuth(), async (u) => {
        setUser(u);
        if (u) { await refresh(); registerForPush().catch(() => undefined); } else setMe(null);
        setLoading(false);
      });
    });
    return () => { alive = false; unsub?.(); };
  }, [refresh]);

  const signIn = async () => {
    setError(null);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      const token = (res as any).data?.idToken ?? (res as any).idToken;
      if (!token) return; // cancelled
      await signInWithCredential(fbAuth(), GoogleAuthProvider.credential(token));
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED || e?.code === statusCodes.IN_PROGRESS) return;
      setError(e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE ? 'Google Play Services is required to sign in.' : e?.message ?? 'Sign-in failed');
    }
  };
  const logout = async () => {
    await unregisterPush().catch(() => undefined);
    await GoogleSignin.signOut().catch(() => undefined);
    await signOut(fbAuth());
    clearApiCache();
    setMe(null);
  };
  return <AuthCtx.Provider value={{ user, me, loading, error, signIn, logout, refresh }}>{children}</AuthCtx.Provider>;
}
