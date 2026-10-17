import { Redirect } from 'expo-router';
import PharmacyNavbar from '../../../pharmacy/PharmacyNavbar';
import { PharmacyProvider } from '../../../pharmacy/PharmacyContext';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

// Pharmacy area: only for a signed-in pharmacy account.
export default function PharmacyLayout() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'pharmacy') return <Redirect href={ROLES[account.role].home} />;
  return <PharmacyProvider><PharmacyNavbar /></PharmacyProvider>;
}
