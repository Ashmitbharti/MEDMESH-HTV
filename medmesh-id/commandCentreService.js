// Shares the MedMesh profile with the MedMesh command centre (base/server.py, POST /api/profile) while the phone
// still has a network. The command centre stores it offline; during a disaster only the 6-letter ID travels over
// the mesh and the command centre uses this profile to choose the right hospital (see base/engine/patient.py).
//
// Set EXPO_PUBLIC_COMMAND_CENTRE_URL in .env, e.g. http://192.168.1.20:8000 (the laptop running server.py).

const HOSPITAL_CODES = {
  'Scarborough General': 'SGH',
  'Centenary Hospital': 'CEN',
  'Birchmount Hospital': 'BIR',
};

const list = (v) => (v || '').split(',').map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));

export function toCommandCentre(profile) {
  const d = profile.details || {};
  return {
    id: profile.medmeshId,
    name: (d.name || '').trim(),
    age: Number(d.age) || null,
    sex: (d.gender === 'Enter my own gender' ? d.customGender : d.gender) || '',
    blood: d.blood || '',
    allergies: list(d.allergies),
    conditions: list(d.conditions),
    meds: list(d.medications),
    devices: list(d.devices),
    contact: (d.contact || '').trim(),
    home_hospital: HOSPITAL_CODES[d.home_hospital] || null,
    lives_alone: d.lives_alone === 'Yes',
    mobility: d.mobility || '',
  };
}

export async function syncCommandCentre(profile) {
  const base = process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL;
  if (!base) return 'off';
  if (!profile.medmeshId) return 'pending';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toCommandCentre(profile)),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok ? 'synced' : 'pending';
  } catch {
    return 'pending';
  } finally {
    clearTimeout(timer);
  }
}
