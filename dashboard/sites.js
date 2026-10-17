// Hospitals and pharmacies known to the MedMesh command centre (same IDs as base/data.py).
// Bundled in the app so "nearest help" works with no internet. GPS works offline.
export const DEFAULT_POS = { lat: 43.7845, lon: -79.1867, approx: true }; // UTSC, used until GPS is available

export const SITES = [
  { id: 'SGH', kind: 'hospital', name: 'Scarborough General', short: 'Scarborough Gen.', lat: 43.7556, lon: -79.2462, open: true },
  { id: 'CEN', kind: 'hospital', name: 'Centenary Hospital', short: 'Centenary', lat: 43.7783, lon: -79.2053, open: true },
  { id: 'UFC', kind: 'clinic', name: 'UTSC Field Clinic', short: 'Field Clinic', lat: 43.7839, lon: -79.1874, open: true },
  { id: 'BIR', kind: 'hospital', name: 'Birchmount Hospital', short: 'Birchmount', lat: 43.8039, lon: -79.3005, open: true },
  { id: 'MSP', kind: 'pharmacy', name: 'Morningside Pharmacy', short: 'Morningside Rx', lat: 43.79, lon: -79.205, open: true },
  { id: 'ECP', kind: 'pharmacy', name: 'Ellesmere Community Rx', short: 'Ellesmere Rx', lat: 43.7765, lon: -79.243, open: true },
  { id: 'MVR', kind: 'pharmacy', name: 'Malvern Rx', short: 'Malvern Rx', lat: 43.808, lon: -79.224, open: false },
  // Home oxygen in Ontario comes from home-oxygen suppliers, not drugstores (demo supplier, not a real company)
  { id: 'SHO', kind: 'supplier', name: 'Scarborough Home Oxygen (demo)', short: 'Home Oxygen', lat: 43.7712, lon: -79.23, open: true },
];

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
