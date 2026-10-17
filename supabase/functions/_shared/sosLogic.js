// COPY of emergency/sosLogic.js for the Supabase functions (functions can only import from supabase/functions).
// Keep in sync with emergency/sosLogic.js and base/engine/sos_ai.py.

export const YNU = ['yes', 'no', 'unknown'];
export const COMPLAINTS = {
  UN: 'Unconscious / not responding', CP: 'Chest pain', BR: 'Breathing problem', BL: 'Bleeding / injury',
  BU: 'Burn', FX: 'Fall / broken bone', PR: 'Pregnancy / labour', OT: 'Other / not sure',
};
export const INCIDENTS = ['crash', 'fall', 'fire', 'flood', 'collapse', 'violence', 'medical', 'other', 'unknown'];

export const blankPerson = (i = 0) => ({
  key: `p${i}-${Math.random().toString(36).slice(2, 6)}`, label: '', age_group: 'unknown', walk: 'unknown', breathing: 'unknown',
  responds: 'unknown', bleeding: 'unknown', complaint: 'OT', trapped: false, note: '', evidence: '', mid: '', fromAi: false,
});

const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const clean = (v, n = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export function normalise(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const people = (Array.isArray(r.people) ? r.people : []).slice(0, 10).filter((p) => p && typeof p === 'object').map((p, i) => ({
    ...blankPerson(i),
    label: clean(p.label, 40),
    age_group: pick(p.age_group, ['child', 'adult', 'senior', 'unknown'], 'unknown'),
    walk: pick(p.walk, YNU, 'unknown'),
    breathing: pick(p.breathing, ['normal', 'fast', 'none', 'unknown'], 'unknown'),
    responds: pick(p.responds, YNU, 'unknown'),
    bleeding: pick(p.bleeding, YNU, 'unknown'),
    complaint: pick(p.complaint, Object.keys(COMPLAINTS), 'OT'),
    trapped: p.trapped === true,
    note: clean(p.note, 60),
    evidence: clean(p.evidence, 100),
    fromAi: true,
  }));
  const count = Math.max(1, Math.min(50, Math.max(Number.parseInt(r.count, 10) || 1, people.length)));
  return {
    language: clean(r.language, 30) || 'unknown',
    translation_en: clean(r.translation_en, 400),
    summary: clean(r.summary, 160),
    incident_type: pick(r.incident_type, INCIDENTS, 'unknown'),
    location_text: clean(r.location_text, 80),
    count,
    caller_is_patient: r.caller_is_patient === true,
    people: people.length ? people : [blankPerson(0)],
  };
}

// Small offline reader for when there is no internet: English, French, Spanish, Hindi (romanised). Fills what it can.
const KW = {
  none: /not breathing|no breathing|isn'?t breathing|ne respire (pas|plus)|no respira|saans nahi/,
  fast: /can'?t breathe|cannot breathe|struggling to breathe|gasping|short of breath|respire mal|no puede respirar/,
  unresp: /unconscious|not respond|unresponsive|passed out|fainted|inconscient|ne r[ée]pond pas|inconsciente|no responde|behosh/,
  bleed: /bleeding (a lot|heavily|badly)|lots of blood|heavy bleeding|blood everywhere|saigne beaucoup|sangra mucho|khoon/,
  CP: /chest pain|heart attack|douleur (à la|a la) poitrine|dolor de pecho|seene mein dard/,
  BU: /burn|br[uû]l|quemad|jal gaya/,
  PR: /pregnan|labou?r|contractions|enceinte|embarazada/,
  FX: /broken|fracture|fell|fall|tomb[ée]|se cay[óo]|ca[ií]da|gir gaya/,
  trap: /trapped|stuck|pinned|coinc[ée]|atrapad/,
  walk: /can walk|walking|peut marcher|puede caminar/,
  child: /child|kid|baby|enfant|b[ée]b[ée]|niñ|bachch?a/,
  senior: /elderly|old (man|woman|lady)|grand(ma|pa|mother|father)|ancian|dadi|nani/,
};
const NUM = { two: 2, three: 3, four: 4, five: 5, deux: 2, trois: 3, quatre: 4, dos: 2, tres: 3, cuatro: 4, several: 3, plusieurs: 3, varios: 3 };

export function rulesInterpret(text) {
  const t = (text || '').toLowerCase();
  const has = (k) => KW[k].test(t);
  let count = 1;
  const m = t.match(/\b(\d{1,2})\s*(people|persons|injured|hurt|personnes|bless|personas|herid|log)/);
  if (m) count = Number(m[1]);
  else {
    const w = Object.keys(NUM).find((k) => new RegExp(`\\b${k}\\b\\s*(people|persons|injured|hurt|personnes|bless|personas|herid)`).test(t));
    if (w) count = NUM[w];
  }
  let complaint = ['CP', 'BU', 'PR', 'FX'].find(has);
  if (!complaint && has('unresp')) complaint = 'UN';
  if (!complaint && (has('none') || has('fast'))) complaint = 'BR';
  if (!complaint && has('bleed')) complaint = 'BL';
  return {
    language: 'unknown', translation_en: '', summary: (text || '').slice(0, 120), incident_type: 'unknown', location_text: '', count,
    people: [{
      age_group: has('child') ? 'child' : has('senior') ? 'senior' : 'unknown', walk: has('walk') ? 'yes' : 'unknown',
      breathing: has('none') ? 'none' : has('fast') ? 'fast' : 'unknown', responds: has('unresp') ? 'no' : 'unknown',
      bleeding: has('bleed') ? 'yes' : 'unknown', complaint: complaint || 'OT', trapped: has('trap'),
      note: has('trap') ? 'trapped' : '', evidence: (text || '').slice(0, 100),
    }],
  };
}

// START triage. Unknown answers are treated as possibly serious, so missing information never moves someone down.
export function triageOf(p) {
  if (p.walk === 'yes') return 3;
  if (['none', 'fast', 'unknown'].includes(p.breathing) || ['no', 'unknown'].includes(p.responds) || ['yes', 'unknown'].includes(p.bleeding)) return 1;
  return 2;
}
export const TRIAGE = { 1: { label: 'Immediate', color: '#f43f5e' }, 2: { label: 'Delayed', color: '#fbbf24' }, 3: { label: 'Minor', color: '#34d399' } };

export function flagsOf(p) {
  return (p.walk === 'yes' ? '1' : '0') + ({ normal: 'N', fast: 'F', none: 'X' }[p.breathing] || 'F')
    + (p.responds === 'yes' ? '1' : '0') + (p.bleeding === 'no' ? '0' : '1');
}

const safe = (s) => String(s || '').replace(/[|;]/g, ' ').replace(/\s+/g, ' ').trim();
const where = (loc) => (loc?.lat != null ? `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}` : '');

// R|id|triage|complaint|age|count|flags|lat,lon|medmeshID|extras
export function reportWire(id, p, { count, loc, sceneId, ai }) {
  const age = { child: 'C', senior: 'S' }[p.age_group] || 'A';
  const note = [p.trapped ? 'trapped' : '', p.note, !loc?.lat && loc?.text ? `at ${loc.text}` : ''].filter(Boolean).join('; ');
  const extras = [sceneId ? `INC:${sceneId}` : '', note ? `NT:${safe(note).slice(0, 60)}` : '', ai ? `AI:${ai}` : ''].filter(Boolean).join(';');
  return `R|${id}|${triageOf(p)}|${p.complaint}|${age}|${count}|${flagsOf(p)}|${where(loc)}|${safe(p.mid).toUpperCase()}|${extras}`;
}

export const sceneWire = (id, count, loc, cause) => `Z|${id}|${count}|${where(loc)}|${safe(cause)}`;
export const voiceWire = (id, loc, lang, text) => `V|${id}|${where(loc)}|${safe(lang).slice(0, 8)}|${String(text || '').replace(/\|/g, ' ')}`;

// One-line summary of a person for cards
export function describe(p) {
  const bits = [];
  if (p.breathing === 'none') bits.push('not breathing');
  else if (p.breathing === 'fast') bits.push('struggling to breathe');
  if (p.responds === 'no') bits.push('not responding');
  if (p.bleeding === 'yes') bits.push('heavy bleeding');
  if (p.walk === 'yes') bits.push('walking');
  if (p.trapped) bits.push('trapped');
  if (p.complaint !== 'OT' && !bits.length) bits.push(COMPLAINTS[p.complaint].toLowerCase());
  return bits.join(' · ') || 'details not given yet';
}
