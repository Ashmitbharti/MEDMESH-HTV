import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile } from '../medmesh-id/profileService';
import { blankPerson } from './sosLogic';

// The current emergency report on this phone (one at a time). Saved after every change, so nothing is lost if the
// app closes. phase: describe -> where -> count -> people -> sent  (or cancelled / closed)
const KEY = 'medmesh-scene';

export async function loadScene() {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { return null; }
}

export async function saveScene(scene) {
  await AsyncStorage.setItem(KEY, JSON.stringify(scene));
  return scene;
}

export const isOpen = (s) => !!s && !['cancelled', 'closed'].includes(s.phase);

export async function createScene(mode) {
  const current = await loadScene();
  if (isOpen(current)) return current;
  const profile = mode === 'self' ? await loadProfile().catch(() => null) : null;
  const me = blankPerson(0);
  if (mode === 'self') {
    me.label = 'You';
    me.responds = 'yes'; // they are using the phone; if they stop answering, auto-send marks this unknown
    me.mid = /^[A-Z]{6}$/.test(profile?.medmeshId || '') ? profile.medmeshId : '';
  }
  return saveScene({
    id: Math.random().toString(36).slice(2, 6), mode, phase: 'describe', createdAt: Date.now(),
    loc: null, count: 1, sceneId: '', cause: '', people: [me], ai: null, sent: {}, voiceId: '',
  });
}
