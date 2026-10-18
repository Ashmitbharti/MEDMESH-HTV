import { Redirect } from 'expo-router';
import CommandNavbar from '../../../command-center/CommandNavbar';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

export default function CommandLayout() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'command') return <Redirect href={ROLES[account.role].home} />;
  return <CommandNavbar />;
}
