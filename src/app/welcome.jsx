import { Redirect } from 'expo-router';
import Welcome from '../../welcome/Welcome';
import { useAuth } from '../../auth/AuthContext';
import { ROLES } from '../../auth/authService';

export default function WelcomeRoute() {
  const { account, ready } = useAuth();
  if (!ready) return null;
  if (account) return <Redirect href={ROLES[account.role].home} />;
  return <Welcome />;
}
