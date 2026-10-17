import AsyncStorage from '@react-native-async-storage/async-storage';
import { SITES } from '../dashboard/sites';
import { fitBytes, queue } from '../dashboard/outbox';
import { setMeshNode } from '../link/meshLink';
import { DEMO_BASE, DEMO_OFFERS, ITEMS } from '../hospital/hospitalService';

// What a pharmacy (or home-oxygen supplier) device sends and receives (see PROTOCOL.md):
//   J|X|MSP|name                              this device is Morningside's
//   MR|req|item|urgency|travel|id|PH1,PH2,PH3|km1,km2,km3|verified    a person nearby needs this (asked 3 places at once)
//   PA|req|OK|minutes  or  PA|req|NO          our answer        MK|req|code|min  we were chosen   MX|req  someone else was
//   SR|id|hospID|item|qty                     a hospital order assigned to us (already price-checked)
//   PR|id|READY/RUNNER/PART:n/OUT/DONE        quick reply (hospital orders, held items)
//   P|MSP|open|ITEM:qty@price,...             stock & price update (only changed items)
//   ND|MSP|hours|ITEM:asked/unmet,...|SECTOR:near/far,...   anonymous demand near us

export const PLACES = SITES.filter((s) => s.kind === 'pharmacy' || s.kind === 'supplier');
export const CAP_PCT = 10;
export const capOf = (item) => (DEMO_BASE[item] ? Math.round(DEMO_BASE[item] * (1 + CAP_PCT / 100) * 100) / 100 : null);
export { ITEMS };

export function pharmacyFor(account) {
  const n = (account?.name || account?.email || '').toLowerCase();
  return PLACES.find((p) => n.includes(p.name.toLowerCase()) || n.includes(p.short.toLowerCase()) || n.startsWith(p.id.toLowerCase()))
    || PLACES.find((p) => n.includes(p.name.split(' ')[0].toLowerCase())) || null;
}

const PICK = 'medmesh-pharmacy-pick';
export async function pickedPharmacy() { try { return await AsyncStorage.getItem(PICK); } catch { return null; } }
export function pickPharmacy(id) { return AsyncStorage.setItem(PICK, id); }

export async function registerPharmacy(p) {
  setMeshNode(`PHARM_${p.id}`);
  return queue('join', `J|X|${p.id}|${p.short}`);
}

// ---------------------------------------------------------------- stock & prices
// Starting stock = the command centre's demo data (data.py). The pharmacy corrects it; accepted requests are taken off
// automatically by the command centre, so most of the time nothing needs typing.
const DEMO_STOCK = {
  MSP: { INSULIN: 12, INHALER: 20, EPIPEN: 4, HEART: 30, SEIZURE: 8, BP: 40, STRIPS: 15, DRESS: 30, NEB: 2 },
  FBP: { INSULIN: 6, INHALER: 10, EPIPEN: 3, HEART: 15, SEIZURE: 4, BP: 20, STRIPS: 8, DRESS: 30, NEB: 0 },
  ECP: { INSULIN: 5, INHALER: 6, EPIPEN: 10, HEART: 12, SEIZURE: 2, BP: 15, STRIPS: 6, DRESS: 12, NEB: 0 },
  MVR: { INSULIN: 20, INHALER: 15, EPIPEN: 6, HEART: 25, SEIZURE: 10, BP: 30, STRIPS: 10, DRESS: 20, NEB: 1 },
  SHO: { O2: 4, CPAPPWR: 3, NEB: 3 },
};
export const FULL = { O2: 6, CPAPPWR: 5, NEB: 5, EPIPEN: 10, SEIZURE: 12 };   // what a "full shelf" looks like, for the 3D bottles
export const fullOf = (item) => FULL[item] || 30;
export const LOW = (item) => Math.max(1, Math.round(fullOf(item) * 0.2));

const KEY = (id) => `medmesh-pharmacy:${id}`;

export async function loadStock(id) {
  const seed = DEMO_STOCK[id] || {};
  const items = Object.fromEntries(Object.keys(ITEMS).filter((k) => seed[k] != null || DEMO_OFFERS[id]?.[k] != null)
    .map((k) => [k, { qty: seed[k] ?? 0, price: DEMO_OFFERS[id]?.[k] ?? DEMO_BASE[k] }]));
  const fallback = { open: true, items, sentAt: 0 };
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY(id))) || 'null');
    return saved ? { ...fallback, ...saved, items: { ...items, ...saved.items } } : fallback;
  } catch { return fallback; }
}

export function changes(draft, sent) {
  return Object.keys(draft.items).filter((k) => {
    const a = draft.items[k], b = sent.items[k];
    return !b || a.qty !== b.qty || a.price !== b.price;
  });
}

// One or more P| messages (each one radio packet), only the items that changed.
export function stockWires(id, draft, keys) {
  const head = `P|${id}|${draft.open ? 1 : 0}|`;
  const parts = keys.map((k) => `${k}:${draft.items[k].qty}@${Number(draft.items[k].price).toFixed(2).replace(/\.00$/, '')}`);
  const out = [];
  let cur = [];
  for (const p of parts) {
    if (new TextEncoder().encode(head + [...cur, p].join(',')).length > 190 && cur.length) { out.push(head + cur.join(',')); cur = []; }
    cur.push(p);
  }
  out.push(head + cur.join(','));
  return out.map((w) => fitBytes(w));
}

export async function sendStock(id, draft, keys) {
  const wires = stockWires(id, draft, keys);
  const sentAt = Date.now();
  for (const [i, w] of wires.entries()) await queue('pharmacy-stock', w, { id: `stock-${sentAt}-${i}` });
  await AsyncStorage.setItem(KEY(id), JSON.stringify({ ...draft, sentAt }));
  return sentAt;
}

export const stockAcked = (inbox, sentAt) => !!sentAt && inbox.some((m) => m.code === 'A' && m.f[0] === 'P' && m.at >= sentAt - 3000);

// ---------------------------------------------------------------- requests
export const URGENCY = {
  N: { label: 'Out now', color: '#f43f5e' },
  D: { label: 'Runs out within 24 h', color: '#fbbf24' },
  3: { label: 'Within 3 days', color: '#7dd3fc' },
};
export const WINDOW_S = 90;

const ACT = (id) => `medmesh-pharmacy-acts:${id}`;
export async function loadActs(id) { try { return JSON.parse((await AsyncStorage.getItem(ACT(id))) || '{}'); } catch { return {}; } }
async function saveAct(id, rid, patch) {
  const all = await loadActs(id);
  all[rid] = { ...all[rid], ...patch, at: Date.now() };
  await AsyncStorage.setItem(ACT(id), JSON.stringify(all));
  return all;
}

export async function answerRequest(pid, rid, ok, minutes) {
  await queue('pharmacy-answer', ok ? `PA|${rid}|OK|${minutes}` : `PA|${rid}|NO`);
  return saveAct(pid, rid, { answer: ok ? 'OK' : 'NO', minutes });
}

export async function reply(pid, id, what) {
  await queue('pharmacy-reply', `PR|${id}|${what}`, { id: `pr-${id}` });
  return saveAct(pid, id, { reply: what });
}

export function requests(inbox, pid, now) {
  const map = new Map();
  for (const m of inbox) {
    const id = m.f[0];
    if (m.code === 'MR') {
      const ids = (m.f[5] || '').split(',');
      const i = ids.indexOf(pid);
      if (i < 0) continue;
      const km = Number((m.f[6] || '').split(',')[i]);
      map.set(id, {
        id, item: m.f[1], urg: m.f[2], travel: m.f[3] === '1', verified: m.f[7] === '1', km: Number.isFinite(km) ? km : null,
        others: ids.length - 1, at: m.at, phase: 'asked',
      });
    } else if (m.code === 'MK' && map.has(id)) {
      map.set(id, { ...map.get(id), phase: 'won', code: m.f[1], minutes: Number(m.f[2]) || 0, wonAt: m.at });
    } else if (m.code === 'MX' && map.has(id)) {
      map.set(id, { ...map.get(id), phase: 'lost' });
    }
  }
  return [...map.values()].map((r) => ({ ...r, left: Math.max(0, Math.round(WINDOW_S - (now - r.at) / 1000)) }));
}

export function orders(inbox) {
  return inbox.filter((m) => m.code === 'SR').map((m) => ({
    id: m.f[0], hospital: SITES.find((s) => s.id === m.f[1])?.name || m.f[1], item: m.f[2], qty: Number(m.f[3]) || 0, at: m.at,
  })).reverse();
}

export function demand(inbox, pid) {
  const m = inbox.filter((x) => x.code === 'ND' && x.f[0] === pid).pop();
  if (!m) return null;
  const items = (m.f[2] || '').split(',').filter(Boolean).map((s) => {
    const [k, v] = s.split(':');
    const [asked, unmet] = (v || '0/0').split('/').map(Number);
    return { item: k, asked, unmet };
  });
  const sectors = Object.fromEntries((m.f[3] || '').split(',').filter(Boolean).map((s) => {
    const [k, v] = s.split(':');
    const [near, far] = (v || '0/0').split('/').map(Number);
    return [k, { near, far }];
  }));
  return { hours: Number(m.f[1]) || 6, items, sectors, at: m.at };
}

// Stock the command centre already took off for us (requests we won, hospital orders) since our last update, so the
// shelf here matches the command centre's copy and a later update never puts back stock that has gone.
export function consumed(inbox, pid, since) {
  const asked = new Map(inbox.filter((m) => m.code === 'MR' && (m.f[5] || '').split(',').includes(pid)).map((m) => [m.f[0], m.f[1]]));
  return inbox.filter((m) => m.at > since && ((m.code === 'MK' && asked.has(m.f[0])) || m.code === 'SR'))
    .map((m) => ({ key: `${m.at}|${m.text}`, item: m.code === 'MK' ? asked.get(m.f[0]) : m.f[2], qty: m.code === 'MK' ? 1 : Number(m.f[3]) || 0 }));
}
