import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { fbAuth, firebaseConfigured, googleProvider, uiPreview } from './firebase';
import { api, ApiError } from './api';
import type { Me } from './types';

interface AuthCtx {
  firebaseUser: User | null;
  me: Me | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/me')); setError(null); }
    catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.code === 'ACCOUNT_SUSPENDED' || err.status === 401) { setMe(null); if (firebaseConfigured) await signOut(fbAuth()).catch(() => undefined); }
    }
  }, []);

  useEffect(() => {
    if (uiPreview) { refresh().finally(() => setLoading(false)); return; }
    if (!firebaseConfigured) { setLoading(false); return; }
    // onIdTokenChanged also fires on hourly token refresh and on revocation/expiry → session expiry handling.
    return onIdTokenChanged(fbAuth(), async (u) => {
      setFirebaseUser(u);
      if (u) await refresh(); else setMe(null);
      setLoading(false);
    });
  }, [refresh]);

  const signIn = async () => {
    setError(null);
    try { await signInWithPopup(fbAuth(), googleProvider); }
    catch (e: any) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(fbAuth(), googleProvider);
      else if (e?.code !== 'auth/popup-closed-by-user') setError(e?.message ?? 'Sign-in failed');
    }
  };
  const logout = async () => { if (firebaseConfigured) await signOut(fbAuth()); setMe(null); localStorage.removeItem('df_drafts'); };

  return <Ctx.Provider value={{ firebaseUser, me, loading, error, signIn, logout, refresh }}>{children}</Ctx.Provider>;
}
