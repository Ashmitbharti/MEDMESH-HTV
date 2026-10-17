// Compares what a report says with the saved profile and produces a list of proposed changes.
// Deterministic, no AI here: Gemini only extracts (with a verbatim quote per item); this file decides
// what is new, what changed and what may be outdated, and the person accepts or rejects each change.

export const split = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
const join = (items) => items.join(', ');
const real = (items) => items.filter((x) => !/^none$/i.test(x));
const safe = (v) => String(v || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

// "Metformin 500 mg twice daily" -> "metformin"; "Type 2 Diabetes" -> "type 2 diabetes"
const medKey = (v) => safe(v).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^(mg|mcg|tab|tabs|daily|twice|once)$/.test(w))[0] || '';
const textKey = (v) => safe(v).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
const sameText = (a, b) => { const x = textKey(a); const y = textKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

const DEVICE_MAP = [
  [/oxygen/i, 'Home oxygen'],
  [/c-?pap|bi-?pap/i, 'CPAP / BiPAP'],
  [/insulin/i, 'Insulin'],
  [/dialysis/i, 'Dialysis'],
  [/wheelchair|walker|rollator/i, 'Wheelchair or walker'],
];
const deviceName = (name) => (DEVICE_MAP.find(([re]) => re.test(name)) || [null, safe(name)])[1];

const GENDER = { f: 'Female', female: 'Female', m: 'Male', male: 'Male' };

export function buildProposals(extracted, details) {
  const out = [];
  let n = 0;
  const push = (p) => out.push({ id: `p${n++}`, accepted: true, ...p });

  // ---- about you: only fill blanks, except blood group which is worth correcting
  const pt = extracted.patient || {};
  if (pt.name && !details.name?.trim()) push({ field: 'name', kind: 'set', value: safe(pt.name), title: `Name: ${pt.name}` });
  if (pt.age !== null && pt.age !== undefined && !details.age?.trim()) {
    push({ field: 'age', kind: 'set', value: String(pt.age), title: `Age: ${pt.age}`, note: extracted.report_date ? `Age on ${extracted.report_date}` : '' });
  }
  if (pt.sex && !details.gender) {
    const g = GENDER[pt.sex.toLowerCase()];
    if (g) push({ field: 'gender', kind: 'set', value: g, title: `Gender: ${g}` });
  }
  if (pt.blood_group && pt.blood_group !== details.blood) {
    push({
      field: 'blood', kind: 'set', value: pt.blood_group, title: `Blood group: ${pt.blood_group}`,
      note: details.blood ? `Your profile says ${details.blood}. Check before accepting.` : '', accepted: !details.blood,
    });
  }

  // ---- allergies
  const allergies = real(split(details.allergies));
  for (const a of extracted.allergies || []) {
    if (allergies.some((x) => sameText(x, a.substance))) continue;
    push({ field: 'allergies', kind: 'add', value: safe(a.substance), title: a.substance, note: a.reaction ? `Reaction: ${a.reaction}` : '', evidence: a.evidence });
  }

  // ---- conditions
  const conditions = real(split(details.conditions));
  for (const cnd of extracted.conditions || []) {
    const have = conditions.find((x) => sameText(x, cnd.name));
    if (cnd.status === 'resolved') {
      if (have) push({ field: 'conditions', kind: 'remove', value: have, title: have, note: 'Report says this is resolved', evidence: cnd.evidence, accepted: false });
    } else if (!have) {
      push({
        field: 'conditions', kind: 'add', value: safe(cnd.name), title: cnd.name, evidence: cnd.evidence,
        note: cnd.status === 'suspected' ? 'Written as possible / suspected, not confirmed' : '', accepted: cnd.status !== 'suspected',
      });
    }
  }

  // ---- medications: new, changed dose, stopped
  const meds = real(split(details.medications));
  for (const m of extracted.medications || []) {
    const full = safe([m.name, m.dose, m.frequency].filter(Boolean).join(' '));
    const have = meds.find((x) => medKey(x) && medKey(x) === medKey(m.name));
    if (m.stopped) {
      if (have) push({ field: 'medications', kind: 'remove', value: have, title: have, note: 'Report says this was stopped', evidence: m.evidence, accepted: false });
    } else if (!have) {
      push({ field: 'medications', kind: 'add', value: full, title: full, evidence: m.evidence });
    } else if (textKey(have) !== textKey(full) && (m.dose || m.frequency)) {
      push({ field: 'medications', kind: 'replace', from: have, value: full, title: full, note: `Was: ${have}`, evidence: m.evidence });
    }
  }

  // ---- devices
  const devices = real(split(details.devices));
  for (const d of extracted.devices || []) {
    const name = deviceName(d.name);
    if (devices.some((x) => sameText(x, name))) continue;
    push({ field: 'devices', kind: 'add', value: name, title: name, evidence: d.evidence });
  }

  // ---- flagged lab results: shared with responders as context, never interpreted here
  const labs = split(details.labs);
  for (const l of (extracted.lab_results || []).filter((x) => ['high', 'low', 'critical'].includes(x.flag))) {
    const line = safe(`${l.test} ${l.value}${l.unit ? ` ${l.unit}` : ''} (${l.flag})`);
    if (labs.some((x) => medKey(x) === medKey(l.test))) continue;
    push({
      field: 'labs', kind: 'add', value: line, title: line, flag: l.flag, evidence: l.evidence,
      note: l.reference_range ? `Reference range ${l.reference_range}` : '',
    });
  }
  return out;
}

export function applyProposals(details, proposals) {
  const next = { ...details };
  for (const p of proposals.filter((x) => x.accepted)) {
    if (p.kind === 'set') { next[p.field] = p.value; continue; }
    let items = real(split(next[p.field]));
    if (p.kind === 'add') items.push(p.value);
    if (p.kind === 'remove') items = items.filter((x) => x !== p.value);
    if (p.kind === 'replace') items = items.map((x) => (x === p.from ? p.value : x));
    next[p.field] = items.length ? join(items) : (p.field === 'labs' ? '' : 'None');
  }
  return next;
}

export const FIELD_LABEL = {
  name: 'About you', age: 'About you', gender: 'About you', blood: 'About you',
  allergies: 'Allergies', conditions: 'Conditions', medications: 'Medications', devices: 'Devices & support', labs: 'Flagged results',
};
