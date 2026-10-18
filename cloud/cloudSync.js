import AsyncStorage from '@react-native-async-storage/async-storage';
import { demoMode, demoSubmit } from '../workflow/demoStore';
import { getSession, getSupabase } from '../lib/supabase';

// Ashmit's Supabase backend, used as a second path next to the mesh. When there is internet and Supabase is set up
// (EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and his migrations run), every update the app
// sends over the mesh is also written to his tables, so his dashboards and data stay current. With no internet the
// mesh path still works on its own; nothing here ever blocks it.
//
//   hospital bed update   -> rpc update_demo_hospital_status      (hospital_status, simulated row)
//   pharmacy stock update -> rpc update_demo_pharmacy_status      (pharmacy_status, simulated row)
//   citizen SOS report    -> rpc submit_emergency_request         (emergency_requests, his Command Center SOS tab)

export const cloudReady = () => !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function explain(error) {
  if (!error) return 'Sync failed';
  if (['PGRST202', '42883', '42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code)) return 'Run the MedMesh SQL migrations in Supabase (see supabase/*-SETUP.md)';
  if (error.code === '42501') return 'Supabase demo access unavailable (enable anonymous sign-in)';
  if (/fetch|network|abort/i.test(error.message || '')) return 'No internet: sent over the mesh only';
  return error.message || 'Sync failed';
}

async function rpc(name, args) {
  try {
    if (name === 'submit_emergency_request' && await demoMode()) return { ok: true, data: await demoSubmit(args.p_payload), text: 'Received by the demo Command Center on this device' };
    await getSession();
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) return { ok: false, text: explain(error) };
    return { ok: true, data, text: 'Also saved to Supabase' };
  } catch (e) {
    return { ok: false, text: explain(e) };
  }
}

export function mirrorHospital(site, fig) {
  if (!site?.cloudId) return Promise.resolve({ ok: false, off: true, text: 'Not in the Supabase directory' });
  const free = Math.max(0, Math.min(10000, fig.free));
  return rpc('update_demo_hospital_status', {
    p_hosid: site.cloudId,
    p_free_beds: free,
    p_free_icu_beds: Math.min(fig.icu, free),
    p_er_wait_minutes: Math.max(0, Math.min(10080, fig.wait)),
    p_is_open: fig.status === 'open',
    p_services: fig.status === 'closed' ? [] : (site.services || []),
    p_reported_at: new Date().toISOString(),
  });
}

// His pharmacy table tracks a seven-item emergency kit; MedMesh tracks prescription items. We keep his other six
// numbers as they are and update the one item both catalogues share (wound dressings).
const KIT = ['paracetamol', 'ibuprofen', 'ors', 'saline', 'dressings', 'gloves', 'antiseptic'];
export async function mirrorPharmacy(site, items, open) {
  if (!site?.cloudId) return { ok: false, off: true, text: 'Not in the Supabase directory' };
  if (!cloudReady()) return { ok: false, off: true, text: 'Supabase not set up: sent over the mesh only' };
  let stock = {};
  try {
    await getSession();
    const { data } = await getSupabase().from('pharmacy_status').select('stock').eq('pharmacy_id', site.cloudId).eq('is_simulated', true).maybeSingle();
    stock = data?.stock || {};
  } catch { /* fall through with zeros */ }
  const full = Object.fromEntries(KIT.map((k) => [k, Math.max(0, Math.min(99999, Number(stock[k]) || 0))]));
  if (items?.DRESS) full.dressings = Math.max(0, Math.min(99999, items.DRESS.qty));
  return rpc('update_demo_pharmacy_status', {
    p_pharmacy_id: site.cloudId, p_stock: full, p_is_open: !!open, p_wait_minutes: 15,
    p_services: site.services || [], p_reported_at: new Date().toISOString(),
  });
}

const YN = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure');
export async function mirrorSos({ id, mode, person, loc, medmeshId, summary }) {
  const answers = {
    complaint: String(person.complaint || 'OT'),
    breathing: String(person.breathing || 'unknown'),
    responding: YN(person.responds),
    heavyBleeding: YN(person.bleeding),
    canWalk: YN(person.walk),
    ageGroup: String(person.age_group || 'unknown'),
  };
  if (person.note) answers.note = String(person.note).slice(0, 200);
  if (summary) answers.summary = String(summary).slice(0, 200);
  const mid = String(medmeshId || person.mid || '').toUpperCase();
  const payload = {
      id: cloudCaseId(id),
      revision: 1,
      mode: mode === 'other' ? 'other' : 'self',
      medmeshId: /^[A-Z]{6}$/.test(mid) ? mid : null,
      phase: 'ready',
      coordinates: Number.isFinite(loc?.lat) && Number.isFinite(loc?.lon) ? { latitude: loc.lat, longitude: loc.lon } : null,
      answers,
      missedQuestions: Object.entries(answers).filter(([, v]) => v === 'Not sure').map(([k]) => k),
      escalation: null,
      conditionUpdates: [],
  };
  const owner = await cloudOwner();
  await editPending((items) => [...items.filter((x) => x.payload.id !== payload.id), { payload, owner, pending: true }]);
  retryCloudSos().catch(() => {});
  return { ok: false, queued: true };
}

export const cloudCaseId = (id) => `medmesh-${String(id).toLowerCase().replace(/[^a-z0-9-]/g, '')}`;

const PENDING = 'medmesh-cloud-sos-v1';
let pendingWrite = Promise.resolve();
let syncing;
async function cloudOwner() {
  const a = JSON.parse(await AsyncStorage.getItem('medmesh-auth') || 'null');
  return a?.role === 'citizen' ? `${a.mode}:${a.demoId || a.medmeshId || a.userId || 'new'}` : '';
}
function editPending(update) {
  const result = pendingWrite.then(async () => {
    const items = JSON.parse(await AsyncStorage.getItem(PENDING) || '[]');
    await AsyncStorage.setItem(PENDING, JSON.stringify(update(items)));
  });
  pendingWrite = result.catch(() => {});
  return result;
}
export async function retryCloudSos() {
  if (syncing) return syncing;
  syncing = (async () => {
    const owner = await cloudOwner();
    if (!owner) return;
    await pendingWrite;
    const items = JSON.parse(await AsyncStorage.getItem(PENDING) || '[]');
    for (const item of items.filter((x) => x.pending && x.owner === owner)) {
      const result = await rpc('submit_emergency_request', { p_payload: item.payload });
      if (!result.ok) throw new Error(result.text);
      await editPending((all) => all.filter((x) => x.payload.id !== item.payload.id || x.owner !== owner));
    }
  })();
  try { return await syncing; } finally { syncing = null; }
}
