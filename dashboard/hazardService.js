import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

// Which disaster is happening where the person is. Decided in this order, and the app always says which one:
//   1. the MedMesh command centre (it knows the active disaster and also broadcasts it over the mesh as X|type|…)
//   2. live weather at the phone's GPS position (only when there is internet)
//   3. the last alert this phone saved while it was online
//   4. nothing known: a calm, neutral "ready" backdrop. We never guess.
// GPS itself works offline (satellites, not internet).

export const HAZARDS = {
  storm: { label: 'Thunderstorm warning', short: 'Storm', tint: ['rgba(99,102,241,0.38)', 'rgba(5,7,15,0)'] },
  rain: { label: 'Heavy rain', short: 'Rain', tint: ['rgba(56,189,248,0.30)', 'rgba(5,7,15,0)'] },
  flood: { label: 'Flood warning', short: 'Flood', tint: ['rgba(14,165,233,0.40)', 'rgba(5,7,15,0)'] },
  snow: { label: 'Snowstorm warning', short: 'Snow', tint: ['rgba(186,230,253,0.30)', 'rgba(5,7,15,0)'] },
  fire: { label: 'Wildfire nearby', short: 'Wildfire', tint: ['rgba(249,115,22,0.38)', 'rgba(5,7,15,0)'] },
  quake: { label: 'Earthquake aftershocks', short: 'Earthquake', tint: ['rgba(168,85,247,0.30)', 'rgba(5,7,15,0)'] },
  calm: { label: 'No active alert', short: 'Clear', tint: ['rgba(56,189,248,0.20)', 'rgba(5,7,15,0)'] },
};
export const DEMO_ORDER = ['storm', 'flood', 'snow', 'fire', 'quake', 'rain', 'calm'];

const FROM_CC = { STORM: 'storm', RAIN: 'rain', FLOOD: 'flood', SNOW: 'snow', FIRE: 'fire', QUAKE: 'quake', HEAT: 'calm', NONE: 'calm' };
const CACHE = 'medmesh-hazard';
const DEMO = 'medmesh-hazard-demo';

async function timed(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// WMO weather codes -> backdrop
function fromWeather(code) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 63 && code <= 67) || code === 81 || code === 82) return 'rain';
  return 'calm';
}

// Demo accounts stand at UTSC (the hackathon venue), so distances and directions match the demo map wherever the
// laptop really is. Real accounts always use GPS.
const DEMO_POS = 'medmesh-demo-pos';
export function setDemoPosition(on) {
  return on ? AsyncStorage.setItem(DEMO_POS, '1') : AsyncStorage.removeItem(DEMO_POS);
}

export async function getPosition() {
  try {
    if (await AsyncStorage.getItem(DEMO_POS)) return { lat: 43.7845, lon: -79.1867, demo: true };
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync();
    const p = last || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
  } catch {
    return null;
  }
}

export async function setDemoHazard(kind) {
  if (!kind) await AsyncStorage.removeItem(DEMO);
  else await AsyncStorage.setItem(DEMO, kind);
}

export async function getHazard() {
  const demo = await AsyncStorage.getItem(DEMO).catch(() => null);
  if (demo && HAZARDS[demo]) return { kind: demo, source: 'Demo mode', at: Date.now(), demo: true };

  const cc = process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL;
  if (cc) {
    try {
      const h = await timed(`${cc.replace(/\/$/, '')}/api/hazard`);
      const out = { kind: FROM_CC[h.type] || 'calm', area: h.area || '', source: 'MedMesh command centre', at: Date.now(), ccOnline: true };
      if (out.kind !== 'calm') await AsyncStorage.setItem(CACHE, JSON.stringify(out));
      return out;
    } catch { /* not reachable: carry on */ }
  }

  const pos = await getPosition();
  // Demo accounts always play the disaster: if the command centre can't be reached, keep the thunderstorm going
  // (labelled as demo) instead of showing the real weather wherever the laptop happens to be.
  if (pos?.demo) return { kind: 'storm', source: 'Demo storm (command centre not reachable)', at: Date.now(), demo: true, pos };
  if (pos) {
    try {
      const w = await timed(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}&current=weather_code`);
      const kind = fromWeather(w?.current?.weather_code ?? 0);
      const out = { kind, source: 'Live weather at your location', at: Date.now(), pos };
      if (kind !== 'calm') await AsyncStorage.setItem(CACHE, JSON.stringify(out));
      return out;
    } catch { /* offline */ }
  }

  const cached = await AsyncStorage.getItem(CACHE).then((v) => (v ? JSON.parse(v) : null)).catch(() => null);
  if (cached && Date.now() - cached.at < 48 * 3600 * 1000) return { ...cached, source: `Saved alert · ${cached.source}`, saved: true, pos };

  return { kind: 'calm', source: 'No alert received yet', at: Date.now(), pos };
}

// Mesh message from the command centre: X|STORM|WARN|Scarborough
export function hazardFromMesh(line) {
  const [code, type, , area] = String(line).split('|');
  if (code !== 'X') return null;
  return { kind: FROM_CC[type] || 'calm', area: area || '', source: 'Command centre · over the mesh', at: Date.now() };
}

export function ago(at) {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// Current hazard for any screen, refreshed every 30 s (hospital, pharmacy and government screens show the same weather).
export function useHazard() {
  const [h, setH] = useState({ kind: 'calm' });
  useEffect(() => {
    let alive = true;
    const load = () => getHazard().then((x) => alive && setH(x)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return h;
}
