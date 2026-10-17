import { Redirect } from 'expo-router';
import Navbar from '../../../navigation/Navbar';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

// Citizen area: only for a signed-in citizen account.
export default function CitizenLayout() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'citizen') return <Redirect href={ROLES[account.role].home} />;
  return <Navbar />;
}
