import { getSession } from '../lib/supabase';
import { normalise, rulesInterpret } from './sosLogic';

// "Tell us in your own words" -> the emergency form. Tries, in order:
//   1. the MedMesh command centre (/api/interpret, Gemini on the laptop; reachable over local Wi-Fi in a disaster)
//   2. the sos-interpret Supabase function (Gemini; needs internet)
//   3. a small offline keyword reader on the phone
// The result is ALWAYS shown to the person to confirm or correct before anything is sent.

const CC = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');
const SB = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function post(url, body, headers = {}, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function interpret(text) {
  const words = (text || '').trim().slice(0, 2000);
  if (!words) throw new Error('Type or say what is happening first.');

  if (CC) {
    try {
      const out = await post(`${CC}/api/interpret`, { text: words });
      if (out?.result) return { source: out.source === 'gemini' ? 'gemini' : 'offline', via: 'command centre', result: normalise(out.result) };
    } catch { /* not reachable */ }
  }
  if (SB && SB_KEY) {
    try {
      const session = await getSession();
      const out = await post(`${SB}/functions/v1/sos-interpret`, { text: words }, { apikey: SB_KEY, Authorization: `Bearer ${session.access_token}` }, 20000);
      if (out?.result) return { source: 'gemini', via: 'online', result: normalise(out.result) };
    } catch { /* offline */ }
  }
  return { source: 'offline', via: 'this phone', result: normalise(rulesInterpret(words)) };
}
