import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile } from '../medmesh-id/profileService';
import { expireRequest } from './questions';

const storageKey = `medmesh-request:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;
let queue = Promise.resolve();

function serialize(action) {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}

export function loadRequest() {
  return serialize(async () => {
    const stored = await AsyncStorage.getItem(storageKey);
    if (!stored) return null;
    let current = JSON.parse(stored);
    // Keep existing answers, but move untouched older requests to identification.
    if (current.phase === 'questions' && current.questionIndex === 0
      && Object.keys(current.answers).length === 0 && !current.version) {
      current = { ...current, version: 2, phase: 'identify', deadline: null, missedQuestions: [], escalation: null };
      await AsyncStorage.setItem(storageKey, JSON.stringify(current));
    }
    const next = expireRequest(current);
    if (next !== current) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  });
}

export function createRequest(mode) {
  return serialize(async () => {
    const stored = await AsyncStorage.getItem(storageKey);
    const previous = stored ? JSON.parse(stored) : null;
    if (previous && previous.phase !== 'cancelled') return previous;
    let profile = null;
    if (mode === 'self') {
      // A profile read failure must not prevent a request without an ID.
      profile = await loadProfile().catch(() => null);
    }
    const now = Date.now();
    const medmeshId = mode === 'self' && /^[A-Z]{6}$/.test(profile?.medmeshId || '')
      ? profile.medmeshId : null;
    const request = {
      version: 2,
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      mode,
      medmeshId,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      deliveryStatus: 'not_sent',
      phase: 'identify',
      questionIndex: 0,
      deadline: null,
      answers: {},
      missedQuestions: [],
      escalation: null,
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(request));
    return request;
  });
}

export function updateRequest(id, update) {
  return serialize(async () => {
    const stored = await AsyncStorage.getItem(storageKey);
    const current = stored ? JSON.parse(stored) : null;
    if (!current || current.id !== id) throw new Error('This request is no longer active.');
    const next = update(current);
    if (next !== current) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  });
}
