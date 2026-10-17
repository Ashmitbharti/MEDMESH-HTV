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
  userId: 'demo-margaret', medmeshId: 'ZP5W1K', status: 'synced', commandCentre: 'pending',
};

export async function seedDemo(account) {
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
