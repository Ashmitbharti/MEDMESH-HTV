import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// The government screens talk to the command centre over its local network (the emergency operations centre sits next
// to it), not over the radio mesh. Everything is read-only and de-identified, and each view is written to the
// command centre's hash-chained audit log. The last copy is kept on the device so the screens still open offline.
export const BASE = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');

async function timed(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function getGov(view, who) {
  const key = `medmesh-gov:${view}`;
  if (BASE) {
    try {
      const data = await timed(`${BASE}/api/gov/${view}?who=${encodeURIComponent(who || 'government')}`);
      AsyncStorage.setItem(key, JSON.stringify({ data, at: Date.now() })).catch(() => {});
      return { data, at: Date.now(), live: true };
    } catch { /* fall back to the saved copy */ }
  }
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(key)) || 'null');
    return saved ? { ...saved, live: false } : { data: null, at: 0, live: false };
  } catch { return { data: null, at: 0, live: false }; }
}

// Poll one view every few seconds while the screen is open.
export function useGov(view, who, every = 5000) {
  const [state, setState] = useState({ data: null, at: 0, live: false, loading: true });
  useEffect(() => {
    let alive = true;
    const load = () => getGov(view, who).then((s) => alive && setState({ ...s, loading: false }));
    load();
    const t = setInterval(load, every);
    return () => { alive = false; clearInterval(t); };
  }, [view, who, every]);
  return state;
}

export async function post(path, body) {
  if (!BASE) throw new Error('No command centre set (EXPO_PUBLIC_COMMAND_CENTRE_URL).');
  return timed(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, 90000);
}

export async function getJSON(path) {
  if (!BASE) throw new Error('No command centre set (EXPO_PUBLIC_COMMAND_CENTRE_URL).');
  return timed(`${BASE}${path}`, {}, 90000);
}

export const TRIAGE = { 1: { label: 'Immediate', color: '#f43f5e' }, 2: { label: 'Delayed', color: '#fbbf24' }, 3: { label: 'Minor', color: '#34d399' }, 4: { label: 'Expectant', color: '#94a3b8' } };
export const NEED_TINT = { O2: '#38bdf8', CPAP: '#a78bfa', DIAL: '#f472b6', INSULIN: '#fbbf24', ALONE: '#94a3b8' };

// lat/lon -> 3D world units (1 unit = 2.5 km), centred on Scarborough
const LAT0 = 43.778;
const LON0 = -79.232;
export function world(lat, lon) {
  return [((lon - LON0) * 111.32 * Math.cos((LAT0 * Math.PI) / 180)) / 2.5, ((lat - LAT0) * 111.32) / 2.5];
}
