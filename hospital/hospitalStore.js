import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession, getSupabase } from '../lib/supabase';

const key = `medmesh-hospital-updates:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;
let queue = Promise.resolve();

export async function readHospitalUpdates() {
  await queue;
  return JSON.parse(await AsyncStorage.getItem(key) || '{}');
}

function storeUpdate(hosid, update) {
  const result = queue.then(async () => {
    const stored = JSON.parse(await AsyncStorage.getItem(key) || '{}');
    if (!update || stored[hosid]?.localId === update.localId || update.pending) {
      stored[hosid] = update;
      await AsyncStorage.setItem(key, JSON.stringify(stored));
    }
  });
  queue = result.catch(() => {});
  return result;
}

export function validateAvailability(values, services) {
  const result = {};
  for (const key of ['freeBeds', 'freeIcuBeds', 'erWaitMinutes']) {
    const value = String(values[key]).trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('Enter a whole number of zero or more in every capacity field.');
    }
    result[key] = Number(value);
  }
  if (result.freeIcuBeds > result.freeBeds) throw new Error('Free ICU beds cannot exceed total free beds.');
  if (result.freeBeds > 10000 || result.erWaitMinutes > 10080) throw new Error('Use at most 10,000 free beds and 10,080 minutes for the demo.');
  return { ...result, open: values.open, services: services.filter((service) => values.services.includes(service)) };
}

export async function saveHospitalAvailability(hospital, values) {
  const data = validateAvailability(values, hospital.services);
  const update = { ...data, pending: true, savedAt: new Date().toISOString(), localId: `${Date.now()}-${Math.random()}` };
  await storeUpdate(hospital.hosid, update);
  return syncHospitalAvailability(hospital.hosid, update);
}

export async function syncHospitalAvailability(hosid, update) {
  try {
    await getSession();
    const response = await getSupabase().rpc('update_demo_hospital_status', {
      p_hosid: hosid,
      p_free_beds: update.freeBeds,
      p_free_icu_beds: update.freeIcuBeds,
      p_er_wait_minutes: update.erWaitMinutes,
      p_is_open: update.open,
      p_services: update.services,
      p_reported_at: update.savedAt,
    });
    if (response.error) throw response.error;
    if (!response.data) throw new Error('No save confirmation was returned.');
    const saved = { ...update, pending: false, receivedAt: response.data };
    await storeUpdate(hosid, saved);
    return { update: saved, message: 'Demo availability saved to Supabase.' };
  } catch (error) {
    let message;
    if (error.code === 'PGRST202' || error.code === '42883') {
      message = 'Saved on this phone. Run the one-time demo hospital updates SQL in Supabase, then retry sync.';
    } else if (error.code === '42501') {
      message = 'Saved on this phone. Demo access is unavailable. Run the demo hospital updates migration and retry.';
    } else if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code)) {
      message = 'Saved on this phone. The hospital tables or columns are missing. Run the hospital SQL migrations in Supabase.';
    } else if (error.code === '23503') {
      message = 'Saved on this phone. This hospital is missing from Supabase. Run the hospital seed migration.';
    } else {
      message = `Saved on this phone. Sync failed: ${error.message || 'check your connection and retry'}${error.code ? ` (${error.code})` : ''}`;
    }
    return {
      update,
      message,
    };
  }
}
