import AsyncStorage from '@react-native-async-storage/async-storage';

// Messages waiting to go out over the mesh, in the command centre's wire format (see PROTOCOL.md).
// They stay here until the phone reaches a MedMesh node; the link layer marks them sent / acknowledged.
const KEY = 'medmesh-outbox';

export const newId = () => Math.random().toString(36).slice(2, 6);

export async function loadOutbox() {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}

export async function queue(kind, wire, meta = {}) {
  const list = await loadOutbox();
  const item = { id: wire.split('|')[1], kind, wire, status: 'queued', at: Date.now(), ...meta };
  const next = [...list.filter((x) => x.id !== item.id), item].slice(-50);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return item;
}

export async function latest(kind) {
  const list = await loadOutbox();
  return [...list].reverse().find((x) => x.kind === kind) || null;
}
