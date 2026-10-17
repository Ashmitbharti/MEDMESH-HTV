import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from '../lib/supabase';

// Three account types. The role lives in Supabase user_metadata.role and decides which dashboard opens.
export const ROLES = {
  citizen: { label: 'Citizen', home: '/' },
  hospital: { label: 'Hospital', home: '/hospital' },
  pharmacy: { label: 'Pharmacy', home: '/pharmacy' },
};

// Demo accounts work with no backend, so the app can be shown fully offline.
export const DEMO = {
  citizen: { email: 'citizen@medmesh.demo', name: 'Margaret' },
  hospital: { email: 'centenary@medmesh.demo', name: 'Centenary Hospital' },
  pharmacy: { email: 'pharmacy@medmesh.demo', name: 'Morningside Pharmacy' },
};

const KEY = 'medmesh-auth';
const supabaseReady = () => !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

// The signed-in account is kept on the phone, so the app still opens when the network is down.
export async function loadAuth() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function remember(account) {
  await AsyncStorage.setItem(KEY, JSON.stringify(account));
  return account;
}

const roleOf = (user, fallback) => (ROLES[user?.user_metadata?.role] ? user.user_metadata.role : fallback);

function friendly(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'That email and password do not match.';
  if (m.includes('already registered')) return 'This email already has an account. Sign in instead.';
  if (m.includes('password')) return 'Use a password with at least 6 characters.';
  if (m.includes('fetch') || m.includes('network') || m.includes('abort')) return 'No internet right now. Try a demo account, or sign in when you are back online.';
  return error?.message || 'Could not sign in. Please try again.';
}

export async function signIn(email, password, chosenRole) {
  if (!supabaseReady()) throw new Error('Supabase is not set up in .env yet. Use a demo account below.');
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    const role = roleOf(data.user, chosenRole);
    if (role !== chosenRole) throw new Error(`This is a ${ROLES[role].label.toLowerCase()} account. Switch to ${ROLES[role].label} above.`);
    return remember({ mode: 'supabase', email: data.user.email, role, name: data.user.user_metadata?.name || '', userId: data.user.id });
  } catch (error) {
    throw new Error(error.message?.startsWith('This is a') ? error.message : friendly(error));
  }
}

export async function signUp(email, password, role, name) {
  if (!supabaseReady()) throw new Error('Supabase is not set up in .env yet. Use a demo account below.');
  try {
    const { data, error } = await getSupabase().auth.signUp({
      email: email.trim(), password, options: { data: { role, name: (name || '').trim() } },
    });
    if (error) throw error;
    if (!data.session) return { needsConfirmation: true };
    return remember({ mode: 'supabase', email: data.user.email, role, name: (name || '').trim(), userId: data.user.id });
  } catch (error) {
    throw new Error(friendly(error));
  }
}

export function demoSignIn(role) {
  return remember({ mode: 'demo', email: DEMO[role].email, role, name: DEMO[role].name });
}

export async function signOut() {
  await AsyncStorage.removeItem(KEY);
  if (supabaseReady()) await getSupabase().auth.signOut().catch(() => {});
}
