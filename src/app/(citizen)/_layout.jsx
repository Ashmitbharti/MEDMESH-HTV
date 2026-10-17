import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { setMeshNode } from '../../../link/meshLink';
import Navbar from '../../../navigation/Navbar';
import { useAuth } from '../../../auth/AuthContext';
import { ROLES } from '../../../auth/authService';

// Citizen area: only for a signed-in citizen account.
export default function CitizenLayout() {
  const { account, ready } = useAuth();
  useEffect(() => { setMeshNode(); }, []);   // a citizen phone is a field device (a hospital login may have switched it)
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== 'citizen') return <Redirect href={ROLES[account.role].home} />;
  return <Navbar />;
}
