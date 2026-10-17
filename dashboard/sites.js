// Hospitals and pharmacies known to the MedMesh command centre (same IDs as base/data.py).
// Bundled in the app so "nearest help" works with no internet. GPS works offline.
export const DEFAULT_POS = { lat: 43.7845, lon: -79.1867, approx: true }; // UTSC, used until GPS is available

// Names, addresses, phones and bed totals: public sources gathered by Ashmit (command-center/facilities.js, checked
// 2026-10-17). Map positions are approximate (placed from the street address). Live beds, stock, prices and open/closed
// status are SIMULATED for the demo; fictional places are marked "(demo)".
const SHN_CONTACTS = { title: 'SHN published site contacts (2025–26)', url: 'https://www.shn.ca/wp-content/uploads/Final-Copy-of-2025_26-Quality-Improvement-Plan-QIP-Narrative-part-1-signed.pdf' };
const SHN_ER = { title: 'SHN emergency services', url: 'https://www.shn.ca/areas-of-care/emergency-and-urgent-care/' };
const SHN_ICU = { title: 'SHN critical care services', url: 'https://www.shn.ca/areas-of-care/critical-care/' };
const HOME_DIR = (id) => ({ title: 'Ontario Health atHome service directory', url: id });
export const VERIFIED_ON = '2026-10-17';
export const SHN_NETWORK = { name: 'Scarborough Health Network', beds: 896, period: 'FY 2024/2025', scope: 'Network-wide total, not a count for each hospital.', source: { title: 'SHN key facts', url: 'https://www.shn.ca/key-facts/' } };

// cloudId / code: the same IDs as Ashmit's Supabase tables (hospitals.hosid, pharmacies.id) and six-digit entry codes.
export const SITES = [
  { id: 'SGH', kind: 'hospital', name: 'SHN General Hospital', short: 'General', lat: 43.7556, lon: -79.2462, open: true,
    cloudId: 'MMH-GEN', code: '100002', address: '3050 Lawrence Avenue East, Scarborough, ON M1P 2V5', phone: '416-438-2911',
    beds: 556, bedsNote: 'secondary source, year unspecified', services: ['Emergency department', 'Intensive care'],
    hours: 'Emergency department open 24 hours, every day.',
    sources: [SHN_CONTACTS, SHN_ER, SHN_ICU, { title: 'Bed count (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Scarborough_General_Hospital_(Toronto)' }] },
  { id: 'CEN', kind: 'hospital', name: 'Centenary Hospital', short: 'Centenary', lat: 43.7783, lon: -79.2053, open: true,
    cloudId: 'MMH-CEN', code: '100001', address: '2867 Ellesmere Road, Scarborough, ON M1E 4B9', phone: '416-284-8131',
    beds: 307, bedsNote: 'secondary source, year unspecified', services: ['Emergency department', 'Intensive care', 'Coronary care'],
    hours: 'Emergency department open 24 hours, every day.',
    sources: [SHN_CONTACTS, SHN_ER, SHN_ICU, { title: 'Bed count (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Centenary_Hospital' }] },
  { id: 'UFC', kind: 'clinic', name: 'UTSC Field Clinic (demo)', short: 'Field Clinic', lat: 43.7839, lon: -79.1874, open: true,
    address: 'Temporary clinic at UTSC (fictional, for the demo)', beds: 10, bedsSimulated: true },
  { id: 'BIR', kind: 'hospital', name: 'Birchmount Hospital', short: 'Birchmount', lat: 43.8016, lon: -79.3046, open: true,
    cloudId: 'MMH-BIR', code: '100003', address: '3030 Birchmount Road, Scarborough, ON M1W 3W3', phone: '416-495-2400',
    beds: 250, bedsSimulated: true, services: ['Emergency department', 'Intensive care'],
    hours: 'Emergency department open 24 hours, every day.', sources: [SHN_CONTACTS, SHN_ER, SHN_ICU] },
  { id: 'MSP', kind: 'pharmacy', name: 'Care IDA Pharmacy', short: 'Care IDA', lat: 43.7868, lon: -79.1745, open: true,
    cloudId: 'care-ida-ellesmere', code: '200001', address: '3600 Ellesmere Road, Unit 2, Scarborough, ON M1C 4Y8', phone: '416-287-6674',
    services: ['General pharmacy', 'Blister packaging', 'Medication reviews'],
    hours: 'Mon–Thu 9am–7pm · Fri 9am–6pm · Sat 10am–3pm', sources: [HOME_DIR('https://lignesantecentre-est.ca/displayService.aspx?id=150258')] },
  { id: 'FBP', kind: 'pharmacy', name: 'Food Basics Pharmacy', short: 'Food Basics', lat: 43.7797, lon: -79.2042, open: true,
    cloudId: 'food-basics-ellesmere', code: '200002', address: '2900 Ellesmere Road, Scarborough, ON M1E 4B8', phone: '416-281-0505',
    services: ['Pharmacy'], hours: 'Mon–Fri 9am–9pm · Sat 9am–6pm · Sun 10am–5pm',
    sources: [{ title: 'Food Basics official location', url: 'https://www.foodbasics.ca/en/find-a-grocery/100863' }] },
  { id: 'ECP', kind: 'pharmacy', name: 'Ellesmere Community Rx (demo)', short: 'Ellesmere Rx', lat: 43.7765, lon: -79.243, open: true,
    address: 'Fictional pharmacy used to demonstrate the price cap' },
  { id: 'MVR', kind: 'pharmacy', name: 'Highland Creek Drugs', short: 'Highland Creek', lat: 43.7853, lon: -79.1717, open: false,
    cloudId: 'highland-creek-drugs', code: '200003', address: '371 Old Kingston Road, Toronto, ON M1C 1B6', phone: '416-286-6522',
    services: ['General pharmacy', 'Prescription delivery', 'Blister packaging', 'Medication reviews'],
    hours: 'Mon–Fri 9am–7pm · Sat–Sun 10am–3pm', sources: [HOME_DIR('https://www.centraleasthealthline.ca/displayservice.aspx?id=150690')] },
  // Home oxygen in Ontario comes from home-oxygen suppliers, not drugstores (demo supplier, not a real company)
  { id: 'SHO', kind: 'supplier', name: 'Scarborough Home Oxygen (demo)', short: 'Home Oxygen', lat: 43.7712, lon: -79.23, open: true,
    address: 'Fictional home-oxygen supplier (demo)' },
];
export const siteByCode = (code) => SITES.find((x) => x.code === String(code || '').trim()) || null;
export const REFERENCE = { name: 'Sam Ibrahim Building, UTSC', address: '1050 Military Trail, Toronto, ON', lat: 43.7845, lon: -79.1867 };

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (rad) => DIRS[Math.round((((rad * 180) / Math.PI + 360) % 360) / 45) % 8];

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// compass bearing from a to b, radians clockwise from north
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.atan2(y, x);
}

export function nearest(pos, kind) {
  return SITES.filter((s) => s.kind === kind && s.open)
    .map((s) => ({ ...s, km: distanceKm(pos, s), bearing: bearing(pos, s) }))
    .sort((a, b) => a.km - b.km)[0] || null;
}

// MedMesh radio nodes (same layout as the command centre's NODE_LAYOUT), so the app can point to the nearest one offline
export const NODES = [
  { id: 'FIELD', name: 'Field node', lat: 43.768, lon: -79.19 },
  { id: 'RELAY', name: 'Relay node', lat: 43.795, lon: -79.215 },
  { id: 'RESP', name: 'Responder node', lat: 43.754, lon: -79.225 },
  { id: 'BASE', name: 'Command centre', lat: 43.785, lon: -79.262 },
];

export function nearestNode(pos) {
  return NODES.map((n) => ({ ...n, km: distanceKm(pos, n), dir: compass(bearing(pos, n)) })).sort((a, b) => a.km - b.km)[0];
}

// Starting values for a hospital's dashboard (same as the command centre's demo data; the hospital edits them)
export const HOSPITAL_DATA = {
  SGH: { total: 556, free: 4, icuTotal: 12, icu: 1, caps: 'CTD', wait: 95, erSpaces: 10 },
  CEN: { total: 307, free: 6, icuTotal: 10, icu: 2, caps: 'CTOPD', wait: 70, erSpaces: 8 },
  BIR: { total: 250, free: 3, icuTotal: 8, icu: 0, caps: 'T', wait: 60, erSpaces: 6 },
  UFC: { total: 10, free: 8, icuTotal: 0, icu: 0, caps: '', wait: 15, erSpaces: 4 },
};

// Everything around a person for the Shield: hospitals and clinics, pharmacies, the home-oxygen supplier (only for
// people who use oxygen or a powered device) and the nearest radio node. Nearest first.
export function around(pos, { oxygen = false } = {}) {
  const at = (x) => ({ ...x, km: distanceKm(pos, x), bearing: bearing(pos, x) });
  const care = SITES.filter((x) => (x.kind === 'hospital' || x.kind === 'clinic') && x.open).map(at).sort((a, b) => a.km - b.km).slice(0, 3);
  const rx = SITES.filter((x) => x.kind === 'pharmacy' && x.open).map(at).sort((a, b) => a.km - b.km).slice(0, 2);
  const o2 = oxygen ? SITES.filter((x) => x.kind === 'supplier' && x.open).map(at).slice(0, 1) : [];
  const node = NODES.map(at).sort((a, b) => a.km - b.km)[0];
  return { care, rx, o2, node };
}
