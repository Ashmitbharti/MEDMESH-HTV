import { Redirect } from 'expo-router';
import GovNavbar from '../../../government/GovNavbar';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

// Government area: only for a signed-in government account. Read-only.
export default function GovernmentLayout() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'government') return <Redirect href={ROLES[account.role].home} />;
  return <GovNavbar />;
}
