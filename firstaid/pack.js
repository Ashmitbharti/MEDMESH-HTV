import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession } from '../lib/supabase';
import { GUIDES, CPR_COACH, TIPS, langName, packLines, personalise } from './content';
import { saveClip } from './audioStore';

// The personal offline emergency pack.
// Built once while online (at MedMesh ID setup): Gemini translates our checked English lines into the person's
// language, back-translates each line so numbers can be verified, and voices the life-saving lines.
// Tries the command centre (/api/pack), then the emergency-pack Supabase function. Without either, the pack is
// English and uses the phone's own voice. After building, nothing needs the internet.
const KEY = 'medmesh-pack';
const CC = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');
const SB = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function loadPack() {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { return null; }
}

async function post(url, body, headers = {}, ms = 120000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

export async function buildPack(details, languageLabel, onStage = () => {}) {
  const language = langName(languageLabel);
  const { items, voice, guides, tips } = packLines(details);
  let out = null;
  let via = '';
  onStage('translating');
  if (language !== 'English' || voice.length) {
    if (CC) {
      try { out = await post(`${CC}/api/pack`, { language, items, voice }); via = 'command centre'; } catch { /* next */ }
    }
    if ((!out || out.source !== 'gemini') && SB && SB_KEY) {
      try {
        const session = await getSession();
        out = await post(`${SB}/functions/v1/emergency-pack`, { language, items, voice }, { apikey: SB_KEY, Authorization: `Bearer ${session.access_token}` });
        via = 'online';
      } catch { /* offline */ }
    }
  }
  const gemini = out?.source === 'gemini';
  const text = {};
  (gemini ? out.items : items).forEach((i) => { text[i.id] = { text: i.text, ok: i.ok !== false, english: !!i.english || !gemini }; });
  onStage('saving');
  const audio = {};
  for (const [id, b64] of Object.entries(gemini ? out.audio || {} : {})) {
    try { audio[id] = await saveClip(`${languageLabel}-${id}`.replace(/[^\w-]/g, '_'), b64); } catch { /* falls back to the phone's voice */ }
  }
  const pack = {
    language: languageLabel, languageName: language, builtAt: Date.now(), source: gemini ? 'gemini' : 'english', via, model: out?.model || '',
    guides, tips, text, audio,
    checks: gemini ? { passed: out.checks?.passed || 0, fallback: out.checks?.fallback || [] } : null,
    error: gemini ? '' : out?.error || (language === 'English' ? '' : 'Could not reach Gemini. Built in English; try again when online.'),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(pack));
  onStage('done');
  return pack;
}

// Text of a line in the pack's language (English source if the pack is missing or the line failed its check)
export function line(pack, id) {
  const t = pack?.text?.[id];
  if (t?.text) return t.text;
  for (const g of Object.values(GUIDES)) { const s = g.steps.find(([k]) => k === id); if (s) return s[1]; }
  const c = CPR_COACH.find(([k]) => k === id);
  if (c) return c[1];
  const tip = Object.values(TIPS).find(([k]) => k === id);
  return tip ? tip[2] : '';
}

export function tipsFor(pack, guide, details) {
  const keys = pack?.tips || personalise(details).tips;
  return keys.map((k) => TIPS[k]).filter((t) => t && t[1] === guide).map(([id]) => ({ id, text: line(pack, id) }));
}
