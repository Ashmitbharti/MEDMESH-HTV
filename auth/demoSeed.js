import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile, storeProfile } from '../medmesh-id/profileService';
import { syncCommandCentre } from '../medmesh-id/commandCentreService';

// Demo citizens: "Margaret" starts with a finished MedMesh ID (so SOS, status, first aid and the government watchlist
// can be tested at once); "new citizen" starts with none, to test the setup questions. Synthetic person, not real.
const MARGARET = {
  details: {
    name: 'Margaret Doyle', age: '79', gender: 'Female', blood: 'AB-', allergies: 'Penicillin', language: 'English',
    conditions: 'Heart failure, Type 2 diabetes', medications: 'Apixaban 5 mg, Insulin', devices: 'Home oxygen',
    communication: 'Hard of hearing', mobility: 'Need some help', lives_alone: 'Yes', home_hospital: 'Centenary Hospital',
    watch: 'Yes', contact: 'Sean Doyle (son), 416-555-0142', labs: '',
  },
  userId: 'demo-margaret', medmeshId: 'DEMOID', status: 'synced', commandCentre: 'pending',
};

// Every demo citizen sign-in starts clean: no open emergency, no old messages, so the demo always begins with
// "Hold SOS for 3 seconds -> questionnaire -> help assigned" instead of an old "help is on the way".
async function freshStart() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k === 'medmesh-scene' || k === 'medmesh-outbox' || k.startsWith('medmesh-inbox'));
  await AsyncStorage.multiRemove(keys);
  await AsyncStorage.setItem('medmesh-inbox-since', String(Date.now() / 1000));   // ignore anything sent before this sign-in
}

export async function seedDemo(account) {
  if (account?.demoId === 'citizen-new') await freshStart();
  if (account?.demoId === 'citizen-new') {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('medmesh-profile:'));
    await AsyncStorage.multiRemove(keys);
  } else if (account?.demoId === 'citizen-margaret') {
    const have = await loadProfile();
    if (have?.medmeshId === MARGARET.medmeshId) return;
    const profile = { ...MARGARET, savedAt: new Date().toISOString() };
    await storeProfile(profile);
    syncCommandCentre(profile).then((st) => storeProfile({ ...profile, commandCentre: st })).catch(() => {});
  }
}
