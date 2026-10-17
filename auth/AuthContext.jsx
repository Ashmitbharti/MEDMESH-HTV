import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as auth from './authService';
import { seedDemo } from './demoSeed';
import { setDemoPosition } from '../dashboard/hazardService';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth.loadAuth().then((a) => { if (a?.mode === 'demo') setDemoPosition(true); setAccount(a); setReady(true); });
  }, []);

  const signIn = useCallback(async (...args) => { const a = await auth.signIn(...args); await setDemoPosition(false); setAccount(a); return a; }, []);
  const signUp = useCallback(async (...args) => {
    const a = await auth.signUp(...args);
    if (!a.needsConfirmation) setAccount(a);
    return a;
  }, []);
  const demo = useCallback(async (which) => { const a = await auth.demoSignIn(which); await seedDemo(a); await setDemoPosition(true); setAccount(a); return a; }, []);
  const enterCode = useCallback(async (role, code) => { const a = await auth.codeSignIn(role, code); await setDemoPosition(true); setAccount(a); return a; }, []);
  const signOut = useCallback(async () => { await auth.signOut(); await setDemoPosition(false); setAccount(null); }, []);

  const value = useMemo(() => ({ account, ready, signIn, signUp, demo, enterCode, signOut }), [account, ready, signIn, signUp, demo, enterCode, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
