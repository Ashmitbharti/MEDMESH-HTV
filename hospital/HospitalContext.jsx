import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { HOSPITALS, hospitalFor, pickedHospital, pickHospital, registerHospital } from './hospitalService';

// Which hospital this signed-in account is. Demo / named accounts match automatically; otherwise staff pick it once.
const Ctx = createContext(null);

export function HospitalProvider({ children }) {
  const { account } = useAuth();
  const auto = hospitalFor(account);
  const [picked, setPicked] = useState(null);
  const [ready, setReady] = useState(!!auto);

  useEffect(() => {
    if (auto) return;
    pickedHospital().then((id) => { setPicked(id); setReady(true); });
  }, [auto]);

  const hospital = auto || HOSPITALS.find((h) => h.id === picked) || null;
  useEffect(() => { if (hospital) registerHospital(hospital); }, [hospital]);

  const value = useMemo(() => ({
    hospital, ready, choose: async (id) => { await pickHospital(id); setPicked(id); },
  }), [hospital, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useHospital = () => useContext(Ctx);
