import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from '../lib/supabase';

// Three account types. The role lives in Supabase user_metadata.role and decides which dashboard opens.
export const ROLES = {
  citizen: { label: 'Citizen', home: '/' },
  hospital: { label: 'Hospital', home: '/hospital' },
  pharmacy: { label: 'Pharmacy', home: '/pharmacy' },
  government: { label: 'Government', home: '/government' },
};

// Demo accounts work with no backend, so the app can be shown fully offline. Several per role so every case can be tested.
export const DEMO_ACCOUNTS = [
  { id: 'citizen-margaret', role: 'citizen', name: 'Margaret', email: 'citizen@medmesh.demo', sub: 'Citizen · 79, heart failure, home oxygen, lives alone · MedMesh ID ready' },
  { id: 'citizen-new', role: 'citizen', name: '', email: 'newcitizen@medmesh.demo', sub: 'Citizen · brand-new phone, no MedMesh ID yet (test the setup questions)' },
  { id: 'hospital-cen', role: 'hospital', name: 'Centenary Hospital', email: 'centenary@medmesh.demo', sub: 'Hospital · cardiac, trauma, obstetrics, paediatrics, dialysis' },
  { id: 'hospital-sgh', role: 'hospital', name: 'Scarborough General', email: 'sgh@medmesh.demo', sub: 'Hospital · busiest ER (95 min wait)' },
  { id: 'pharmacy-msp', role: 'pharmacy', name: 'Morningside Pharmacy', email: 'pharmacy@medmesh.demo', sub: 'Pharmacy · fair prices' },
  { id: 'pharmacy-ecp', role: 'pharmacy', name: 'Ellesmere Community Rx', email: 'ellesmere@medmesh.demo', sub: 'Pharmacy · insulin and EpiPen above the cap (tests price flags)' },
  { id: 'supplier-sho', role: 'pharmacy', name: 'Scarborough Home Oxygen (demo)', email: 'oxygen@medmesh.demo', sub: 'Home-oxygen supplier · oxygen, CPAP power' },
  { id: 'government', role: 'government', name: 'City Emergency Operations (demo)', email: 'eoc@medmesh.demo', sub: 'Government · read-only overview, analysis, watchlist' },
];
export const DEMO = Object.fromEntries(Object.keys(ROLES).map((r) => [r, DEMO_ACCOUNTS.find((a) => a.role === r)]));

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

export function demoSignIn(which) {
  const a = DEMO_ACCOUNTS.find((x) => x.id === which) || DEMO[which];
  return remember({ mode: 'demo', email: a.email, role: a.role, name: a.name, demoId: a.id });
}

export async function signOut() {
  await AsyncStorage.removeItem(KEY);
  if (supabaseReady()) await getSupabase().auth.signOut().catch(() => {});
}
