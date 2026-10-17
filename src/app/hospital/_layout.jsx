import { Redirect } from 'expo-router';
import HospitalNavbar from '../../../hospital/HospitalNavbar';
import { HospitalProvider } from '../../../hospital/HospitalContext';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

// Hospital area: only for a signed-in hospital account.
export default function HospitalLayout() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'hospital') return <Redirect href={ROLES[account.role].home} />;
  return <HospitalProvider><HospitalNavbar /></HospitalProvider>;
}
