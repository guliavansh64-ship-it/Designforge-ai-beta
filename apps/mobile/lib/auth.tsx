import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, onIdTokenChanged, signInWithCredential, signOut, type User } from 'firebase/auth';
import { fbAuth, firebaseConfigured } from './firebase';
import { api, ApiError, cacheHydrated, loadApiUrlOverride, wipeApiCache } from './api';
import { registerForPush, unregisterPush } from './push';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Me } from './types';

// Startup speed: the last profile is cached on the device, so the app opens instantly
// (no waiting for the free server to wake up). It is refreshed in the background right away.
const ME_CACHE = 'df.me.v1';
const saveMe = (m: Me | null) => (m ? AsyncStorage.setItem(ME_CACHE, JSON.stringify(m)) : AsyncStorage.removeItem(ME_CACHE)).catch(() => undefined);

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
    try { const m = await api.get<Me>('/me'); setMe(m); saveMe(m); setError(null); }
    catch (e) {
      const err = e as ApiError; setError(err.message);
      if (err.code === 'ACCOUNT_SUSPENDED' || err.status === 401) { setMe(null); saveMe(null); await signOut(fbAuth()).catch(() => undefined); }
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); setError('App is not configured (Firebase env missing).'); return; }
    let unsub: (() => void) | undefined; let alive = true;
    // 1) Show the cached profile immediately (signed-in users see the app in well under a second).
    // The saved API cache is loaded first, so the first screens paint with data instead of spinners.
    Promise.all([AsyncStorage.getItem(ME_CACHE), cacheHydrated]).then(([raw]) => {
      if (!alive || !raw) return;
      try { setMe((cur) => cur ?? (JSON.parse(raw) as Me)); setLoading(false); } catch { /* ignore */ }
    }).catch(() => undefined);
    // Never keep the user on the loading screen for long.
    const failSafe = setTimeout(() => { if (alive) setLoading(false); }, 2500);
    // 2) Load a saved test-server URL (test builds only) BEFORE the first /me call.
    loadApiUrlOverride().finally(() => {
      if (!alive) return;
      unsub = onIdTokenChanged(fbAuth(), async (u) => {
        setUser(u);
        if (!u) { setMe(null); saveMe(null); wipeApiCache(); setLoading(false); return; }
        const hadCache = !!(await AsyncStorage.getItem(ME_CACHE).catch(() => null));
        if (hadCache) { setLoading(false); refresh().then(() => registerForPush({ prompt: false }).catch(() => undefined)); }
        else { await refresh(); setLoading(false); registerForPush({ prompt: false }).catch(() => undefined); }
      });
    });
    return () => { alive = false; clearTimeout(failSafe); unsub?.(); };
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
    wipeApiCache();
    saveMe(null);
    setMe(null);
  };
  return <AuthCtx.Provider value={{ user, me, loading, error, signIn, logout, refresh }}>{children}</AuthCtx.Provider>;
}
