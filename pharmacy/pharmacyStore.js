import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession, getSupabase } from '../lib/supabase';
import { catalogue } from './catalogue';

const key = `medmesh-pharmacy-updates:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;
let queue = Promise.resolve();

export async function readPharmacyUpdates() {
  await queue;
  return JSON.parse(await AsyncStorage.getItem(key) || '{}');
}

function storeUpdate(id, update) {
  const result = queue.then(async () => {
    const stored = JSON.parse(await AsyncStorage.getItem(key) || '{}');
    if (update.pending || stored[id]?.localId === update.localId) {
      stored[id] = update;
      await AsyncStorage.setItem(key, JSON.stringify(stored));
    }
  });
  queue = result.catch(() => {});
  return result;
}

export async function savePharmacyAvailability(pharmacy, values) {
  const stock = {};
  for (const item of catalogue) {
    const value = String(values.stock[item.id] ?? '').trim();
    if (!/^\d{1,5}$/.test(value)) throw new Error('Enter a whole quantity from 0 to 99,999 for every stock item.');
    stock[item.id] = Number(value);
  }
  if (!/^\d{1,5}$/.test(String(values.waitMinutes).trim()) || Number(values.waitMinutes) > 10080) {
    throw new Error('Enter a preparation time from 0 to 10,080 minutes.');
  }
  const update = {
    stock,
    waitMinutes: Number(values.waitMinutes),
    open: values.open,
    services: pharmacy.services.filter((service) => values.services.includes(service)),
    pending: true,
    localId: `${Date.now()}-${Math.random()}`,
    savedAt: new Date().toISOString(),
  };
  await storeUpdate(pharmacy.id, update);
  return syncPharmacyAvailability(pharmacy.id, update);
}

export async function syncPharmacyAvailability(id, update) {
  try {
    await getSession();
    const { data, error } = await getSupabase().rpc('update_demo_pharmacy_status', {
      p_pharmacy_id: id,
      p_stock: update.stock,
      p_is_open: update.open,
      p_wait_minutes: update.waitMinutes,
      p_services: update.services,
      p_reported_at: update.savedAt,
    });
    if (error) throw error;
    if (!data) throw new Error('No save confirmation returned.');
    const saved = { ...update, pending: false, receivedAt: data };
    await storeUpdate(id, saved);
    return { update: saved, message: 'Demo pharmacy availability saved to Supabase.' };
  } catch (error) {
    const setupMissing = ['PGRST202', '42883', '42P01', 'PGRST205', '42501'].includes(error.code);
    return {
      update,
      message: setupMissing
        ? 'Saved on this phone. Run the one-time pharmacies SQL in Supabase, then retry sync.'
        : `Saved on this phone. Sync failed: ${error.message || 'check your connection and retry'}${error.code ? ` (${error.code})` : ''}`,
    };
  }
}
