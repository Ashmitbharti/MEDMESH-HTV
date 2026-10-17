import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { loadOutbox, saveOutbox } from '../dashboard/outbox';

// The phone's connection to the MedMesh network.
//
//   wifi-sim : the command centre's simulated mesh over Wi-Fi (EXPO_PUBLIC_COMMAND_CENTRE_URL, server.py --sim).
//              Messages go through the same handlers, hop simulation and replies as real radio traffic.
//   (next)   : Bluetooth to a Meshtastic node, behind the same send()/subscribe() interface. Needs a dev build.
//
// Every message is first saved in the outbox, so nothing is lost when there is no link; flush() sends what is queued.

const BASE = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');
const NODE = process.env.EXPO_PUBLIC_MESH_NODE || 'FIELD';
const INBOX = 'medmesh-inbox';
const SINCE = 'medmesh-inbox-since';

let state = { kind: BASE ? 'wifi-sim' : 'none', connected: false, lastSeen: 0, error: '' };
const listeners = new Set();
let timer = null;
let busy = false;

const emit = () => listeners.forEach((fn) => fn(state));

async function timed(url, opts = {}, ms = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function loadInbox() {
  try { return JSON.parse((await AsyncStorage.getItem(INBOX)) || '[]'); } catch { return []; }
}

// Messages for one request/case id, oldest first: [{code, f:[...], text, at}]
export function forId(inbox, id) {
  return inbox.filter((m) => m.f[0] === id);
}

function parse(text) {
  const parts = String(text).split('|');
  return { code: parts[0], f: parts.slice(1), text };
}

async function sendRaw(wire) {
  if (state.kind !== 'wifi-sim') return false;
  try {
    const r = await timed(`${BASE}/api/sim/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ node: NODE, text: wire }),
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

export async function flush() {
  const list = await loadOutbox();
  let changed = false;
  for (const m of list) {
    if (m.status !== 'queued') continue;
    if (await sendRaw(m.wire)) { m.status = 'sent'; m.sentAt = Date.now(); changed = true; } else break;
  }
  if (changed) { await saveOutbox(list); emit(); }
}

async function poll() {
  if (busy || state.kind !== 'wifi-sim') return;
  busy = true;
  try {
    const since = Number(await AsyncStorage.getItem(SINCE)) || Date.now() / 1000 - 600;
    const msgs = await timed(`${BASE}/api/sim/inbox/${NODE}?since=${since}`);
    state = { ...state, connected: true, lastSeen: Date.now(), error: '' };
    if (Array.isArray(msgs) && msgs.length) {
      const inbox = await loadInbox();
      const seen = new Set(inbox.map((m) => `${m.at}|${m.text}`));
      let last = since;
      for (const m of msgs) {
        last = Math.max(last, m.ts);
        const item = { ...parse(m.text), at: m.ts * 1000 };
        if (!seen.has(`${item.at}|${item.text}`)) inbox.push(item);
      }
      await AsyncStorage.setItem(INBOX, JSON.stringify(inbox.slice(-200)));
      await AsyncStorage.setItem(SINCE, String(last));
      // acknowledgements move outbox items forward
      const out = await loadOutbox();
      let changed = false;
      for (const o of out) {
        const mine = forId(inbox, o.id);
        if (mine.some((x) => x.code === 'A') && o.status !== 'acked') { o.status = 'acked'; changed = true; }
      }
      if (changed) await saveOutbox(out);
    }
    await flush();
  } catch {
    state = { ...state, connected: false, error: 'Command centre not reachable' };
  } finally {
    busy = false;
    emit();
  }
}

export function startLink() {
  if (timer || state.kind === 'none') return;
  poll();
  timer = setInterval(poll, 2500);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function linkState() {
  return state;
}

// React hook: link status + inbox + outbox, refreshed whenever the link changes.
export function useMesh() {
  const [snap, setSnap] = useState({ link: state, inbox: [], outbox: [] });
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [inbox, outbox] = await Promise.all([loadInbox(), loadOutbox()]);
      if (alive) setSnap({ link: state, inbox, outbox });
    };
    startLink();
    refresh();
    const off = subscribe(refresh);
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
