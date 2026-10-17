import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PLACES, pharmacyFor, pickedPharmacy, pickPharmacy, registerPharmacy } from './pharmacyService';

// Which pharmacy (or oxygen supplier) this account is. Demo / named accounts match automatically; otherwise staff pick it once.
const Ctx = createContext(null);

export function PharmacyProvider({ children }) {
  const { account } = useAuth();
  const auto = pharmacyFor(account);
  const [picked, setPicked] = useState(null);
  const [ready, setReady] = useState(!!auto);

  useEffect(() => {
    if (auto) return;
    pickedPharmacy().then((id) => { setPicked(id); setReady(true); });
  }, [auto]);

  const pharmacy = auto || PLACES.find((p) => p.id === picked) || null;
  useEffect(() => { if (pharmacy) registerPharmacy(pharmacy); }, [pharmacy]);

  const value = useMemo(() => ({
    pharmacy, ready, choose: async (id) => { await pickPharmacy(id); setPicked(id); },
  }), [pharmacy, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePharmacy = () => useContext(Ctx);
