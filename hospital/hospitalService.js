import AsyncStorage from '@react-native-async-storage/async-storage';
import { HOSPITAL_DATA, SITES } from '../dashboard/sites';
import { newId, queue } from '../dashboard/outbox';
import { setMeshNode } from '../link/meshLink';

// Everything the hospital screens send and receive over the mesh (see PROTOCOL.md):
//   J|H|CEN|name                      this device is Centenary's
//   C|CEN|free|icu|caps|open|wait|note  bed / ICU / ER update (routing trusts fresh updates more)
//   I|case|triage|complaint|age|pickup+drive|BG:..;AL:..    a patient is coming here (classified by the command centre)
//   IU|case|PK/ARR/AWAY|min           picked up · arrived · sent elsewhere      HA|case|READY/FULL  our answer
//   ZA|scene|count|cause|hazards      a scene with several casualties was reported
//   S|id|CEN|ITEM|qty[|ALLOW]  ->  SA|id|PHARM:qty@price,..|short:n|cost:x|over:PHARM@price   fair-price supplies

const BASE = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');
export const HOSPITALS = SITES.filter((s) => s.kind === 'hospital' || s.kind === 'clinic');

export function hospitalFor(account) {
  const n = (account?.name || account?.email || '').toLowerCase();
  return HOSPITALS.find((h) => n.includes(h.name.toLowerCase()) || n.includes(h.short.toLowerCase().replace('.', '')) || n.startsWith(h.id.toLowerCase()))
    || HOSPITALS.find((h) => n.includes(h.name.split(' ')[0].toLowerCase())) || null;
}

const PICK = 'medmesh-hospital-pick';
export async function pickedHospital() { try { return await AsyncStorage.getItem(PICK); } catch { return null; } }
export function pickHospital(id) { return AsyncStorage.setItem(PICK, id); }

// This device joins the mesh as the hospital's own node, so incoming-patient messages reach it.
export async function registerHospital(h) {
  setMeshNode(`HOSP_${h.id}`);
  return queue('join', `J|H|${h.id}|${h.short}`);
}

// ---------------------------------------------------------------- the hospital's own figures
export const STATUS = {
  open: { label: 'Accepting', sub: 'Send patients here', tint: '#34d399' },
  divert: { label: 'Diverting', sub: 'Full: send others elsewhere', tint: '#fbbf24' },
  closed: { label: 'Closed', sub: 'No patients', tint: '#f43f5e' },
};
export const CAPS = [
  { k: 'C', label: 'Cardiac' }, { k: 'T', label: 'Trauma' }, { k: 'B', label: 'Burns' },
  { k: 'O', label: 'Obstetrics' }, { k: 'P', label: 'Paediatrics' }, { k: 'D', label: 'Dialysis' },
];
export const WAITS = [
  { label: 'Under 15 min', min: 10 }, { label: '15–30 min', min: 25 }, { label: '30–60 min', min: 45 },
  { label: '1–2 hours', min: 90 }, { label: 'Over 2 hours', min: 150 },
];
export const NOTES = ['Neurosurgeon on call', 'No CT / MRI right now', 'Generator power only', 'Low on O-neg blood', 'Decontamination available', 'Ventilators available'];

const KEY = (id) => `medmesh-hospital:${id}`;

export async function loadFigures(id) {
  const base = HOSPITAL_DATA[id] || { total: 10, free: 5, icuTotal: 0, icu: 0, caps: '', wait: 30, erSpaces: 4 };
  const fallback = { ...base, status: 'open', note: '', sentAt: 0 };
  try { return { ...fallback, ...JSON.parse((await AsyncStorage.getItem(KEY(id))) || '{}') }; } catch { return fallback; }
}

export function saveFigures(id, fig) { return AsyncStorage.setItem(KEY(id), JSON.stringify(fig)); }

export const ascii = (s) => (s || '').replace(/[|\n]/g, ' ').replace(/[^\x20-\x7e]/g, '').trim();

export async function sendFigures(id, fig) {
  const open = fig.status === 'open' ? 1 : 0;
  const note = ascii(fig.status === 'divert' && !fig.note ? 'Diverting: full' : fig.status === 'closed' && !fig.note ? 'Closed' : fig.note).slice(0, 40);
  const wire = `C|${id}|${fig.free}|${fig.icu}|${fig.caps}|${open}|${fig.wait}|${note}`;
  const sentAt = Date.now();
  await saveFigures(id, { ...fig, sentAt });
  await queue('hospital', wire);
  return sentAt;
}

// The command centre answers C| with A|C|OK
export const updateAcked = (inbox, sentAt) => !!sentAt && inbox.some((m) => m.code === 'A' && m.f[0] === 'C' && m.at >= sentAt - 3000);

// ---------------------------------------------------------------- incoming patients
export const TRIAGE = {
  1: { label: 'Immediate', short: 'RED', color: '#f43f5e' },
  2: { label: 'Delayed', short: 'YELLOW', color: '#fbbf24' },
  3: { label: 'Minor', short: 'GREEN', color: '#34d399' },
  4: { label: 'Expectant', short: 'BLACK', color: '#94a3b8' },
};
export const COMPLAINT = {
  CP: 'Chest pain', BR: 'Breathing problem', BL: 'Bleeding / injury', BU: 'Burn', UN: 'Unresponsive',
  PR: 'Pregnancy / labour', FX: 'Fall / fracture', OT: 'Other / unclear',
};
export const AGE = { A: 'Adult', C: 'Child', S: 'Senior', U: 'Age unknown' };

// Prompts to get ready, by what the caller described. The hospital's own protocols decide; this only saves a minute.
export const PREPARE = {
  CP: ['12-lead ECG at the door', 'Defibrillator in the bay', 'Cardiology / cath lab aware'],
  BR: ['Oxygen and airway cart', 'Suction ready', 'Respiratory therapist aware'],
  BL: ['Trauma bay', 'Blood products for the group below', 'Tourniquet and haemostatic dressings'],
  BU: ['Burn dressings', 'Warmed fluids', 'Burns centre transfer if needed'],
  UN: ['Resus bay', 'Airway kit', 'Glucose check on arrival'],
  PR: ['Obstetrics on the way down', 'Delivery kit', 'Neonatal warmer'],
  FX: ['X-ray booked', 'Splints and traction', 'Orthopaedics aware'],
  OT: ['Triage nurse at the door', 'General bay'],
};

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

export function incoming(inbox, now) {
  const map = new Map();
  for (const m of inbox) {
    const id = m.f[0];
    if (m.code === 'I') {
      const [pick, drive] = String(m.f[4] || '0+0').split('+').map(num);
      const extra = Object.fromEntries(String(m.f[5] || '').split(';').map((kv) => kv.split(':')).filter((kv) => kv.length === 2));
      const prev = map.get(id);
      map.set(id, {
        id, triage: num(m.f[1]) || 2, complaint: m.f[2] || 'OT', age: m.f[3] || 'U', blood: extra.BG && extra.BG !== '?' ? extra.BG : '',
        allergies: extra.AL ? extra.AL.split(',') : [], pick, drive, phase: 'coming', arriveAt: m.at + (pick + drive) * 60000,
        firstAt: prev?.firstAt || m.at, at: m.at, ready: prev?.ready || false,
      });
    } else if (m.code === 'IU' && map.has(id)) {
      const p = map.get(id);
      if (m.f[1] === 'PK') map.set(id, { ...p, phase: 'enroute', arriveAt: m.at + num(m.f[2]) * 60000 });
      if (m.f[1] === 'ARR') map.set(id, { ...p, phase: 'arrived', arriveAt: m.at, arrivedAt: m.at });
      if (m.f[1] === 'AWAY') map.set(id, { ...p, phase: 'away', awayAt: m.at });
    }
  }
  const list = [...map.values()].map((p) => ({ ...p, mins: Math.max(0, Math.round((p.arriveAt - now) / 60000)) }));
  const rank = { arrived: 0, enroute: 1, coming: 2, away: 3 };
  return list.sort((a, b) => (a.phase === 'away') - (b.phase === 'away') || a.triage - b.triage || a.arriveAt - b.arriveAt || rank[a.phase] - rank[b.phase]);
}

export function scenes(inbox) {
  return inbox.filter((m) => m.code === 'ZA').map((m) => ({ id: m.f[0], count: num(m.f[1]), cause: m.f[2] || '', hazards: (m.f[3] || '').split(',').filter(Boolean), at: m.at })).reverse();
}

export async function answer(caseId, what) {
  return queue('hospital-ack', `HA|${caseId}|${what}`);
}

// ---------------------------------------------------------------- fair-price supplies
export const ITEMS = {
  O2: 'Oxygen cylinder', INSULIN: 'Insulin', INHALER: 'Inhaler', EPIPEN: 'EpiPen', DRESS: 'Wound dressings', NEB: 'Nebuliser',
  STRIPS: 'Test strips & needles', HEART: 'Heart medication', SEIZURE: 'Seizure medication', BP: 'Blood-pressure meds', CPAPPWR: 'CPAP power pack',
};
export const PLACES = Object.fromEntries(SITES.filter((s) => s.kind === 'pharmacy' || s.kind === 'supplier').map((s) => [s.id, s.short]));

// Bundled copy of the command centre's demo prices (data.py), used until /api/prices has been fetched once.
export const DEMO_BASE = { INSULIN: 40, INHALER: 30, EPIPEN: 120, HEART: 25, SEIZURE: 35, BP: 18, STRIPS: 45, DRESS: 8, NEB: 90, O2: 60, CPAPPWR: 150 };
export const DEMO_OFFERS = {
  MSP: { INSULIN: 41, INHALER: 31, EPIPEN: 125, HEART: 25, SEIZURE: 36, BP: 18, STRIPS: 46, DRESS: 8.5, NEB: 92 },
  FBP: { INSULIN: 42, INHALER: 30, EPIPEN: 122, HEART: 25, SEIZURE: 35, BP: 18, STRIPS: 47, DRESS: 8 },
  ECP: { INSULIN: 64, INHALER: 29, EPIPEN: 199, HEART: 26, SEIZURE: 35, BP: 19, STRIPS: 70, DRESS: 8 },
  MVR: { INSULIN: 40, INHALER: 30, EPIPEN: 120, HEART: 25, SEIZURE: 35, BP: 18, STRIPS: 45, DRESS: 8, NEB: 90 },
  SHO: { O2: 63, CPAPPWR: 240, NEB: 95 },
};
const OPEN = { MSP: true, FBP: true, ECP: true, MVR: false, SHO: true };

function demoPrices() {
  const capPct = 10;
  const items = Object.fromEntries(Object.entries(DEMO_BASE).map(([k, base]) => {
    const cap = Math.round(base * (1 + capPct / 100) * 100) / 100;
    const offers = Object.entries(DEMO_OFFERS).filter(([, o]) => o[k] != null).map(([p, o]) => ({
      pharm: p, name: PLACES[p], price: o[k], open: OPEN[p], within: o[k] <= cap, pct: Math.round(1000 * (o[k] / base - 1)) / 10,
    }));
    return [k, { item: k, base, cap, offers }];
  }));
  return { cap_pct: capPct, items, flags: [], note: 'Demo prices', source: 'bundled', at: 0 };
}

const PRICES = 'medmesh-prices';
export async function loadPrices() {
  let cached = null;
  try { cached = JSON.parse((await AsyncStorage.getItem(PRICES)) || 'null'); } catch { cached = null; }
  if (BASE) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${BASE}/api/prices`, { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      const fresh = { ...j, source: 'live', at: Date.now() };
      await AsyncStorage.setItem(PRICES, JSON.stringify(fresh));
      return fresh;
    } catch { /* offline: use the copy we have */ }
  }
  return cached ? { ...cached, source: 'cached' } : demoPrices();
}

export async function requestSupply(hid, item, qty, allow) {
  const id = newId();
  return queue('hospital-supply', `S|${id}|${hid}|${item}|${qty}${allow ? '|ALLOW' : ''}`, { item, qty, allow });
}

export function supplyResult(inbox, id) {
  const m = inbox.filter((x) => x.code === 'SA' && x.f[0] === id).pop();
  if (!m) return null;
  const lines = (m.f[1] || '').split(',').filter(Boolean).map((s) => {
    const [p, rest] = s.split(':');
    const [n, pr] = (rest || '').split('@');
    return { pharm: p, qty: num(n), price: num(pr) };
  });
  const kv = Object.fromEntries(m.f.slice(2).map((s) => [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)]));
  const over = (kv.over || '').split(',').filter(Boolean).map((s) => { const [p, pr] = s.split('@'); return { pharm: p, price: num(pr) }; });
  // SU|id|pharm|READY/RUNNER/PART:n/OUT   each pharmacy's own reply about this order
  const replies = Object.fromEntries(inbox.filter((x) => x.code === 'SU' && x.f[0] === id).map((x) => [x.f[1], x.f[2]]));
  return { lines, short: num(kv.short), cost: num(kv.cost), over, replies, at: m.at };
}

export function replyText(code) {
  if (!code) return '';
  if (code.startsWith('PART:')) return `Only ${code.slice(5)} available`;
  return { READY: 'Ready for pickup', RUNNER: 'Sending a runner', OUT: 'Can’t supply it', DONE: 'Handed over' }[code] || code;
}
