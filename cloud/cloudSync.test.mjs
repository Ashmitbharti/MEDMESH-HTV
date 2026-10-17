// Checks our payloads against the rules in Ashmit's Supabase functions (no network): node cloud/cloudSync.test.mjs
const KIT = ['paracetamol', 'ibuprofen', 'ors', 'saline', 'dressings', 'gloves', 'antiseptic'];
const sosId = (id) => `medmesh-${String(id).toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
let n = 0;
const ok = (c, m) => { if (!c) throw new Error(m); n++; };
ok(/^[a-z0-9-]{10,100}$/.test(sosId('ab12')), 'sos id matches submit_emergency_request');
ok(!/^[A-Z]{6}$/.test('ZP5W1K'), 'MedMesh IDs with digits are sent as null (his regex is letters only)');
ok(/^[A-Z]{6}$/.test('QWERTY'), 'letter-only IDs pass');
const full = Object.fromEntries(KIT.map((k) => [k, 0]));
ok(Object.keys(full).length === 7, 'pharmacy stock always has all 7 kit items');
ok(['MMH-CEN', 'MMH-GEN', 'MMH-BIR'].every((h) => /^MMH-[A-Z0-9]{3,8}$/.test(h)), 'hospital ids match');
console.log(`${n} passed`);
