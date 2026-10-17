import AsyncStorage from '@react-native-async-storage/async-storage';

// Messages waiting to go out over the mesh, in the command centre's wire format (see PROTOCOL.md).
// status: queued -> sent (handed to the link) -> acked (command centre replied A|id|OK)
const KEY = 'medmesh-outbox';

export const newId = () => Math.random().toString(36).slice(2, 6);

export async function loadOutbox() {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}

export function saveOutbox(list) {
  return AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-80)));
}

// Keep each message within one LoRa packet (bytes, not characters: other languages use more bytes per letter).
export function fitBytes(wire, max = 200) {
  let s = wire;
  while (new TextEncoder().encode(s).length > max) s = s.slice(0, -1);
  return s;
}

export async function queue(kind, wire, meta = {}) {
  const list = await loadOutbox();
  const w = fitBytes(wire);
  const item = { id: w.split('|')[1], kind, wire: w, status: 'queued', at: Date.now(), ...meta };
  await saveOutbox([...list.filter((x) => x.id !== item.id), item]);
  // hand it to the link straight away if there is one (lazy import avoids a require cycle)
  import('../link/meshLink').then((m) => m.flush()).catch(() => {});
  return item;
}

export async function markOutbox(id, patch) {
  const list = await loadOutbox();
  await saveOutbox(list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

export async function latest(kind) {
  const list = await loadOutbox();
  return [...list].reverse().find((x) => x.kind === kind) || null;
}
