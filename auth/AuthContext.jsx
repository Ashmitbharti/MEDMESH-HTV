import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as auth from './authService';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth.loadAuth().then((a) => { setAccount(a); setReady(true); });
  }, []);

  const signIn = useCallback(async (...args) => { const a = await auth.signIn(...args); setAccount(a); return a; }, []);
  const signUp = useCallback(async (...args) => {
    const a = await auth.signUp(...args);
    if (!a.needsConfirmation) setAccount(a);
    return a;
  }, []);
  const demo = useCallback(async (role) => { const a = await auth.demoSignIn(role); setAccount(a); return a; }, []);
  const signOut = useCallback(async () => { await auth.signOut(); setAccount(null); }, []);

  const value = useMemo(() => ({ account, ready, signIn, signUp, demo, signOut }), [account, ready, signIn, signUp, demo, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
