import { hospitals, pharmacies } from '../command-center/facilities';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from '../lib/supabase';
import { siteByCode } from '../dashboard/sites';
import { loadProfile, storeProfile, syncProfile } from '../medmesh-id/profileService';
import { CITIZEN_DETAILS } from './citizenProfile';
import { getSession } from '../lib/supabase';

// Four entry points. The role lives in Supabase user_metadata.role and decides which dashboard opens.
export const ROLES = {
  citizen: { label: 'Citizen', home: '/' },
  hospital: { label: 'Hospital', home: '/hospital' },
  pharmacy: { label: 'Pharmacy', home: '/pharmacy' },
  command: { label: 'Command Center', home: '/command-center/sos' },
};

// Demo accounts work with no backend, so the app can be shown fully offline. Several per role so every case can be tested.
export const DEMO_ACCOUNTS = [
  { id: 'citizen-margaret', role: 'citizen', name: 'Margaret', email: 'citizen@medmesh.demo', sub: 'Citizen · 79, heart failure, home oxygen, lives alone · MedMesh ID ready' },
  { id: 'citizen-new', role: 'citizen', name: '', email: 'newcitizen@medmesh.demo', sub: 'Citizen · brand-new phone, no MedMesh ID yet (test the setup questions)' },
  { id: 'hospital-cen', role: 'hospital', name: 'Centenary Hospital', email: 'centenary@medmesh.demo', sub: 'Hospital · 307 beds · cardiac, trauma, obstetrics, paediatrics, dialysis' },
  { id: 'hospital-sgh', role: 'hospital', name: 'SHN General Hospital', email: 'sgh@medmesh.demo', sub: 'Hospital · 556 beds · busiest ER' },
  { id: 'pharmacy-msp', role: 'pharmacy', name: 'Care IDA Pharmacy', email: 'pharmacy@medmesh.demo', sub: 'Pharmacy · 3600 Ellesmere Rd · fair prices (stock simulated)' },
  { id: 'pharmacy-fbp', role: 'pharmacy', name: 'Food Basics Pharmacy', email: 'foodbasics@medmesh.demo', sub: 'Demo pharmacy · medicine requests and inventory' },
  { id: 'pharmacy-hcd', role: 'pharmacy', name: 'Highland Creek Pharmacy', email: 'highland@medmesh.demo', sub: 'Demo pharmacy · medicine requests and inventory' },
  { id: 'command', role: 'command', name: 'Command Center', email: 'command@medmesh.demo', sub: 'Demo · dispatch ambulances, assign hospitals and route supplies' },
];
export const DEMO = Object.fromEntries(Object.keys(ROLES).map((r) => [r, DEMO_ACCOUNTS.find((a) => a.role === r)]));

const KEY = 'medmesh-auth';
const supabaseReady = () => !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

// The signed-in account is kept on the phone, so the app still opens when the network is down.
export async function loadAuth() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const a = raw ? JSON.parse(raw) : null;
    if (a?.mode === 'demo') { await AsyncStorage.removeItem(KEY); return null; }
    return a?.role === 'government' ? { ...a, role: 'command' } : a;
  } catch {
    return null;
  }
}

async function remember(account) {
  await AsyncStorage.setItem(KEY, JSON.stringify(account));
  return account;
}

const roleOf = (user, fallback) => user?.user_metadata?.role === 'government' ? 'command' : (ROLES[user?.user_metadata?.role] ? user.user_metadata.role : fallback);

function friendly(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'That email and password do not match.';
  if (m.includes('already registered')) return 'This email already has an account. Sign in instead.';
  if (m.includes('password')) return 'Use a password with at least 6 characters.';
  if (m.includes('fetch') || m.includes('network') || m.includes('abort')) return 'No internet right now. Sign in when you are back online.';
  return error?.message || 'Could not sign in. Please try again.';
}

export async function signIn(email, password, chosenRole) {
  if (!supabaseReady()) throw new Error('Supabase is not set up in .env yet.');
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
  if (!supabaseReady()) throw new Error('Supabase is not set up in .env yet.');
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
  const facility = a.role === 'hospital' ? hospitals.find((h) => h.name === a.name) || hospitals[0] : a.role === 'pharmacy' ? pharmacies.find((p) => p.pharmacyCode === ({ 'pharmacy-msp': '200001', 'pharmacy-fbp': '200002', 'pharmacy-hcd': '200003' })[a.id]) || pharmacies[0] : null;
  return remember({ mode: 'demo', email: a.email, role: a.role, name: facility?.name || a.name, demoId: a.id, facilityId: facility?.hosid || facility?.id });
}

export async function signOut() {
  await AsyncStorage.removeItem(KEY);
  if (supabaseReady()) await getSupabase().auth.signOut().catch(() => {});
}

// Ashmit's six-digit entry codes (HosID 100001-100003, PharmID 200001-200003). A code picks the facility; it is a
// demo shortcut, not staff authentication.
export function codeSignIn(role, code) {
  if (role === 'command') {
    if (code !== '111111') throw new Error('Incorrect Command Center key.');
    return remember({ mode: 'facility', role: 'command', name: 'Command Center' });
  }
  const site = siteByCode(code);
  const ok = site && (role === 'hospital' ? site.kind === 'hospital' : site.kind === 'pharmacy');
  if (!ok) throw new Error(role === 'hospital' ? 'No hospital found for this HosID.' : 'No pharmacy found for this PharmID.');
  return remember({ mode: 'facility', email: `${site.code}@medmesh.demo`, role, name: site.name, facilityId: site.cloudId });
}

// An ID identifies the citizen's request. It never grants access to another person's medical record.
export async function idSignIn(value) {
  const medmeshId = value.trim().toUpperCase();
  if (!/^[A-Z]{6}$/.test(medmeshId)) throw new Error('Enter your six-letter MedMesh ID.');
  const saved = await loadProfile();
  const own = saved?.medmeshId === medmeshId;
  if (!own) {
    if (saved) await AsyncStorage.setItem(`medmesh-profile-backup:${saved.medmeshId || 'draft'}`, JSON.stringify(saved));
    const backup = JSON.parse(await AsyncStorage.getItem(`medmesh-profile-backup:${medmeshId}`) || 'null');
    await storeProfile(backup || { medmeshId, details: {}, status: 'identified', userId: null });
    await AsyncStorage.removeItem('medmesh-scene');
  }
  return remember({ mode: 'id', role: 'citizen', medmeshId, name: own ? saved.details?.name || '' : '' });
}

export async function newCitizen() {
  const saved = await loadProfile();
  if (saved?.medmeshId) throw new Error('A MedMesh ID is already saved on this phone. Enter that ID to continue.');
  await getSession();
  return remember({ mode: 'id', role: 'citizen', name: '', newProfile: true });
}

export function switchRole() { return AsyncStorage.removeItem(KEY); }

// Reuse this session's registered ID. No email, password or repeated setup form.
export async function openCitizen() {
  const saved = await loadProfile();
  let session;
  try { session = await getSession(); }
  catch (error) {
    if (saved?.status !== 'synced' || !/^[0-9a-f-]{36}$/i.test(saved.userId || '')) throw error;
    return remember({ mode: 'id', role: 'citizen', medmeshId: saved.medmeshId, userId: saved.userId, name: saved.details.name });
  }
  const { data: row, error } = await getSupabase().from('medical_profiles').select('*')
    .eq('user_id', session.user.id).maybeSingle();
  if (error) {
    if (saved?.status === 'synced' && saved.userId === session.user.id && /fetch|network|abort/i.test(error.message || '')) {
      return remember({ mode: 'id', role: 'citizen', medmeshId: saved.medmeshId, userId: saved.userId, name: saved.details.name });
    }
    throw new Error('Could not load the MedMesh ID from Supabase. Check your connection and retry.');
  }
  const own = saved?.userId === session.user.id && (!row || saved.medmeshId === row.medmesh_id);
  if (saved && !own) await AsyncStorage.setItem(`medmesh-profile-backup:${saved.medmeshId || 'draft'}`, JSON.stringify(saved));
  const details = {
    ...CITIZEN_DETAILS,
    ...(own ? saved.details : {}),
    ...(row ? {
      name: row.full_name, age: String(row.age), gender: row.gender, blood: row.blood_group,
      allergies: row.allergies, conditions: row.conditions, medications: row.medications,
      contact: row.emergency_contact,
    } : {}),
  };
  const profile = row ? {
    ...(own ? saved : {}), details, userId: row.user_id, medmeshId: row.medmesh_id,
    status: 'synced', syncedAt: new Date().toISOString(),
  } : await syncProfile({ details, userId: session.user.id, medmeshId: null, status: 'pending', savedAt: new Date().toISOString() });
  await storeProfile(profile);
  return remember({ mode: 'id', role: 'citizen', medmeshId: profile.medmeshId, userId: session.user.id, name: profile.details.name });
}
