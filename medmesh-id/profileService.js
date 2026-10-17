import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession, getSupabase } from '../lib/supabase';
import { syncCommandCentre } from './commandCentreService';

const storageKey = `medmesh-profile:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;

export async function loadProfile() {
  const stored = await AsyncStorage.getItem(storageKey);
  return stored ? JSON.parse(stored) : null;
}

export function storeProfile(profile) {
  return AsyncStorage.setItem(storageKey, JSON.stringify(profile));
}

function profileValues(details) {
  return {
    full_name: details.name.trim(),
    age: Number(details.age),
    gender: (details.gender === 'Enter my own gender' ? details.customGender : details.gender).trim(),
    blood_group: details.blood,
    allergies: details.allergies.trim(),
    conditions: details.conditions.trim(),
    medications: details.medications.trim(),
    emergency_contact: details.contact.trim(),
  };
}

export async function syncProfile(profile) {
  const session = await getSession();
  if (profile.userId && profile.userId !== session.user.id) {
    throw new Error('This Medical ID belongs to a different session. Your local copy has been kept.');
  }
  const supabase = getSupabase();
  const userId = session.user.id;
  const values = profileValues(profile.details);

  // Reuse the cloud ID on retries, including when the previous response was lost.
  const { data: existing, error: lookupError } = await supabase
    .from('medical_profiles').select('user_id, medmesh_id').eq('user_id', userId).maybeSingle();
  if (lookupError) throw new Error('Could not read your profile. Check that the Medical ID SQL setup has been run.');
  if (profile.medmeshId && existing?.medmesh_id !== profile.medmeshId) {
    throw new Error('Your cloud ID does not match this local copy. Your local record has been kept.');
  }

  let record;
  for (let attempt = 0; attempt < 5; attempt++) {
    const query = existing
      ? supabase.from('medical_profiles').update(values).eq('user_id', userId)
      : supabase.from('medical_profiles').insert({ user_id: userId, ...values });
    const { data, error } = await query.select('user_id, medmesh_id').single();
    if (!error) {
      record = data;
      break;
    }
    if (error.code !== '23505' || existing) {
      throw new Error('Could not save to Supabase. Check your connection and table permissions, then retry.');
    }
  }
  if (!record) throw new Error('Could not assign an ID. Please retry syncing.');

  const saved = {
    ...profile,
    userId: record.user_id,
    medmeshId: record.medmesh_id,
    status: 'synced',
    syncedAt: new Date().toISOString(),
  };
  await storeProfile(saved);
  return saved;
}

export async function saveProfile(details, previous) {
  const draft = {
    details,
    userId: previous?.userId || null,
    medmeshId: previous?.medmeshId || null,
    status: 'pending',
    savedAt: new Date().toISOString(),
    syncedAt: previous?.syncedAt || null,
  };
  await storeProfile(draft);

  let result;
  try {
    result = { profile: await syncProfile(draft), syncError: '' };
  } catch (error) {
    result = { profile: draft, syncError: error.message || 'Sync failed. Retry when internet is available.' };
  }
  // Share with the MedMesh command centre once an ID exists, so it can use the profile offline in a disaster.
  const commandCentre = await syncCommandCentre(result.profile);
  result.profile = { ...result.profile, commandCentre };
  await storeProfile(result.profile);
  return result;
}
