import { demoMode, readDemo, demoSupply } from '../workflow/demoStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession, getSupabase } from '../lib/supabase';
import { catalogue } from '../pharmacy/catalogue';

const storageKey = `medmesh-supplies:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;
let queue = Promise.resolve();

async function readSaved() {
  await queue;
  return JSON.parse(await AsyncStorage.getItem(storageKey) || '[]');
}

function remember(requests) {
  const result = queue.then(async () => {
    const stored = JSON.parse(await AsyncStorage.getItem(storageKey) || '[]');
    const merged = new Map(stored.map((item) => [item.id, item]));
    for (const item of requests) merged.set(item.id, item);
    await AsyncStorage.setItem(storageKey, JSON.stringify([...merged.values()]));
  });
  queue = result.catch(() => {});
  return result;
}

export function requestedItems(quantities) {
  const items = {};
  for (const item of catalogue) {
    const value = String(quantities[item.id] ?? '').trim();
    if (!value || /^0+$/.test(value)) continue;
    if (!/^[0-9]{1,5}$/.test(value)) throw new Error('Use whole quantities from 0 to 99,999.');
    items[item.id] = Number(value);
  }
  if (!Object.keys(items).length) throw new Error('Choose at least one medicine or supply quantity.');
  return items;
}

export function pharmacyCanSupply(pharmacy, items) {
  const status = pharmacy.pharmacyAvailability;
  return pharmacy.availabilityIsSimulated !== false && status?.open === true && Object.entries(items).every(([key, quantity]) =>
    Number.isFinite(status.stock?.[key]) && status.stock[key] >= quantity);
}

function syncMessage(error) {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code)) {
    return 'Run the latest supply-request migration in Supabase, then retry.';
  }
  return error.message || 'Check your connection and retry.';
}

export async function createSupplyRequest(hospitalId, quantities, priority) {
  const items = requestedItems(quantities);
  const request = {
    id: `supply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    hospital_id: hospitalId,
    pharmacy_id: null,
    items,
    priority,
    status: 'awaiting_assignment',
    assignment_version: 0,
    is_simulated: true,
    created_at: new Date().toISOString(),
    pending: true,
  };
  await remember([request]);
  return sendSupplyRequest(request);
}

export async function sendSupplyRequest(request) {
  if (await demoMode()) return { request: await demoSupply(request, 'create'), message: 'Received by Command Center in this device’s demo.' };
  try {
    await getSession();
    const { data, error } = await getSupabase().rpc('create_routed_demo_supply_request', {
      p_id: request.id,
      p_hospital_id: request.hospital_id,
      p_items: request.items,
      p_priority: request.priority,
    });
    if (error) throw error;
    if (!data?.id) throw new Error('No delivery confirmation returned.');
    const saved = { ...data, pending: false };
    await remember([saved]);
    return { request: saved, message: 'Received by Command Center through Supabase. Check request status for pharmacy assignment.' };
  } catch (error) {
    return { request, message: `Saved on this phone · delivery unconfirmed. ${syncMessage(error)}` };
  }
}

export async function loadSupplyRequests(mode, id) {
  if (await demoMode()) {
    const state = await readDemo();
    return { requests: state.supplies.filter((r) => mode === 'command' || (mode === 'hospital' ? r.hospital_id : r.pharmacy_id) === id), message: 'Demo on this device · switch roles to follow the order.' };
  }
  const field = mode === 'command' ? null : mode === 'hospital' ? 'hospital_id' : 'pharmacy_id';
  const local = (await readSaved()).filter((item) => (!field || item[field] === id) && (mode === 'hospital' || !item.pending));
  try {
    await getSession();
    let query = getSupabase().from('supply_requests').select('*');
    if (field) query = query.eq(field, id);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const remote = data.map((item) => ({ ...item, pending: false }));
    await remember(remote);
    const receivedIds = new Set(remote.map((item) => item.id));
    const pending = local.filter((item) => item.pending && !receivedIds.has(item.id));
    return { requests: [...pending, ...remote], message: 'Inbox refreshed from Supabase.' };
  } catch (error) {
    return { requests: local, message: `Showing saved requests. ${syncMessage(error)}` };
  }
}

export async function updateSupplyRequest(request, status) {
  if (await demoMode()) return demoSupply(request, status);
  await getSession();
  const response = status === 'accepted'
    ? getSupabase().rpc('approve_demo_supply_to_hospital', { p_id: request.id, p_pharmacy_id: request.pharmacy_id, p_assignment_version: request.assignment_version })
    : status === 'closed'
    ? getSupabase().rpc('confirm_demo_hospital_supply_receipt', { p_id: request.id, p_hospital_id: request.hospital_id })
    : getSupabase().rpc('advance_routed_demo_supply_request', {
    p_id: request.id,
    p_status: status,
    p_pharmacy_id: request.pharmacy_id,
    p_assignment_version: request.assignment_version,
  });
  const { data, error } = await response;
  if (error) throw new Error(syncMessage(error));
  if (!data?.id) throw new Error('No status confirmation returned.');
  const saved = { ...data, pending: false };
  await remember([saved]);
  return saved;
}

export async function assignSupplyRequest(request, pharmacyId) {
  if (await demoMode()) return demoSupply(request, 'assign', pharmacyId);
  await getSession();
  const { data, error } = await getSupabase().rpc('assign_demo_supply_request', {
    p_id: request.id,
    p_pharmacy_id: pharmacyId,
    p_expected_version: request.assignment_version,
  });
  if (error) throw new Error(syncMessage(error));
  if (!data?.id) throw new Error('No assignment confirmation returned.');
  const saved = { ...data, pending: false };
  await remember([saved]);
  return saved;
}
