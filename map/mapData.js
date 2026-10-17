import AsyncStorage from '@react-native-async-storage/async-storage';
import bundled from './area.json';

// Offline street map. The app ships with a small map of the area (bundled), and replaces it with the command
// centre's map (real OpenStreetMap roads once prepare_map.py has run) the first time it can reach it. After that it
// works with no internet at all.
const KEY = 'medmesh-map';
const CC = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');

export async function loadMap() {
  try {
    const cached = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
    if (cached?.geo?.roads?.length) return cached.geo;
  } catch { /* ignore */ }
  return bundled;
}

export async function refreshMap() {
  if (!CC) return null;
  try {
    const cached = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
    if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const geo = await fetch(`${CC}/api/map`, { signal: ctl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
    if (!geo?.roads?.length) return null;
    await AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), geo }));
    return geo;
  } catch {
    return null;
  }
}
