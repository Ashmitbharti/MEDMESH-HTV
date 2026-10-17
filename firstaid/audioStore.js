import { Platform } from 'react-native';
import * as FS from 'expo-file-system/legacy';

// Where the pack's voice clips live: files on the phone (native) or IndexedDB (web preview).
// Each clip is a WAV produced by Gemini text-to-speech while online; afterwards it plays with no internet.
const DB = 'medmesh-audio';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function webPut(key, b64) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').put(b64, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

async function webGet(key) {
  const db = await idb();
  return new Promise((res) => { const rq = db.transaction('clips').objectStore('clips').get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); });
}

export async function saveClip(key, b64) {
  if (Platform.OS === 'web') { await webPut(key, b64); return `idb:${key}`; }
  const dir = `${FS.documentDirectory}medmesh-pack/`;
  await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const uri = `${dir}${key}.wav`;
  await FS.writeAsStringAsync(uri, b64, { encoding: FS.EncodingType.Base64 });
  return uri;
}

// A URI the audio player can open
export async function clipUri(ref) {
  if (!ref) return null;
  if (!ref.startsWith('idb:')) return ref;
  const b64 = await webGet(ref.slice(4)).catch(() => null);
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
