import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile } from '../medmesh-id/profileService';
import { expireRequest } from './questions';
import { applyReceipt, reviseRequest, validReceipt } from './requestLifecycle';

const storageKey = `medmesh-request:${process.env.EXPO_PUBLIC_SUPABASE_URL || 'offline'}`;
let queue = Promise.resolve();
let transport = null;
const listeners = new Set();

export function subscribeRequest(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(request) {
  for (const listener of listeners) listener(request);
}

// The hardware adapter must verify acknowledgments before passing them here.
export function setMeshTransport(adapter) {
  transport = adapter;
}

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
    const next = reviseRequest(current, expireRequest(current));
    if (next !== current) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  });
}

export function createRequest(mode) {
  return serialize(async () => {
    const stored = await AsyncStorage.getItem(storageKey);
    const previous = stored ? JSON.parse(stored) : null;
    if (previous && previous.phase !== 'cancelled') return previous;
    if (previous) {
      const historyKey = `${storageKey}:history`;
      const history = JSON.parse(await AsyncStorage.getItem(historyKey) || '[]');
      await AsyncStorage.setItem(historyKey, JSON.stringify([
        previous, ...history.filter((item) => item.id !== previous.id),
      ]));
    }
    let profile = null;
    if (mode === 'self') {
      // A profile read failure must not prevent a request without an ID.
      profile = await loadProfile().catch(() => null);
    }
    const now = Date.now();
    const medmeshId = mode === 'self' && /^[A-Z]{6}$/.test(profile?.medmeshId || '')
      ? profile.medmeshId : null;
    const request = {
      version: 3,
      revision: 1,
      commandRevision: 0,
      nodeRevision: 0,
      deliveryEvents: [],
      conditionUpdates: [],
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
    const next = reviseRequest(current, update(current));
    if (next !== current) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    notify(next);
    return next;
  });
}

export function receiveReceipt(receipt) {
  return serialize(async () => {
    if (!receipt || typeof receipt.requestId !== 'string') return null;
    const stored = await AsyncStorage.getItem(storageKey);
    const current = stored ? JSON.parse(stored) : null;
    if (!current || current.id !== receipt.requestId) {
      const historyKey = `${storageKey}:history`;
      const history = JSON.parse(await AsyncStorage.getItem(historyKey) || '[]');
      const index = history.findIndex((item) => item.id === receipt.requestId);
      if (index < 0) return null;
      const updated = applyReceipt(history[index], receipt);
      history[index] = updated;
      await AsyncStorage.setItem(historyKey, JSON.stringify(history));
      notify(updated);
      return updated;
    }
    const next = applyReceipt(current, receipt);
    if (next !== current) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    notify(next);
    return next;
  });
}

export async function retryDelivery(id) {
  const active = await loadRequest();
  const request = active?.id === id ? active : (await loadRequestHistory()).find((item) => item.id === id);
  if (!request || request.id !== id) throw new Error('This request is no longer active.');
  if (!transport) throw new Error('No mesh node connected. Your request and updates are saved on this phone.');
  const packet = {
    requestId: request.id,
    revision: request.revision || 1,
    mode: request.mode,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    phase: request.phase,
    medmeshId: request.medmeshId,
    coordinates: request.coordinates || null,
    answers: request.answers,
    missedQuestions: request.missedQuestions,
    escalation: request.escalation,
    escalatedAt: request.escalatedAt || null,
    conditionUpdates: request.conditionUpdates || [],
    cancelled: request.phase === 'cancelled',
  };
  let timeout;
  let receipt;
  try {
    receipt = await Promise.race([
      transport.send(packet),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('No acknowledgment yet. Your request remains saved.')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (!receipt) throw new Error('No delivery acknowledgment yet. Your request remains saved.');
  if (!validReceipt(request, receipt)) {
    throw new Error('Delivery acknowledgment was not valid. Your request remains saved.');
  }
  const saved = await receiveReceipt(receipt);
  if (!saved) throw new Error('The acknowledgment did not match this request.');
  return saved;
}

export async function loadRequestHistory() {
  await queue;
  return JSON.parse(await AsyncStorage.getItem(`${storageKey}:history`) || '[]');
}
