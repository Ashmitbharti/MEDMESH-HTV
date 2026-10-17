// Reads a medical report (PDF or photo) with the Gemini API and returns structured, evidence-backed facts.
//
// Design rules (why this is not "just a wrapper"):
//  - Gemini only EXTRACTS what the document states. Every item must carry a short verbatim quote (`evidence`).
//    Items without evidence are dropped here, server-side, before anything reaches the phone.
//  - Output is constrained by a JSON schema, then validated and normalised here (types, enums, lengths,
//    blood-group format, de-duplication).
//  - The app then compares the result with the saved profile deterministically and the person accepts or rejects
//    each proposed change. Nothing is written to the profile automatically, and nothing is diagnosed.
//  - The report itself is never stored.

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

const str = { type: 'string' };
const evidence = { type: 'string', description: 'Short verbatim quote from the document that states this item.' };

export const SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', description: 'e.g. lab report, discharge summary, prescription, checkup summary' },
    report_date: { type: 'string', description: 'Date of the report as written, or empty' },
    patient: {
      type: 'object',
      properties: { name: str, age: { type: 'integer' }, sex: str, blood_group: str },
    },
    allergies: {
      type: 'array',
      items: { type: 'object', properties: { substance: str, reaction: str, evidence }, required: ['substance', 'evidence'] },
    },
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: str, status: { type: 'string', enum: ['active', 'resolved', 'suspected'] }, evidence },
        required: ['name', 'status', 'evidence'],
      },
    },
    medications: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: str, dose: str, frequency: str, stopped: { type: 'boolean' }, evidence },
        required: ['name', 'evidence'],
      },
    },
    lab_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          test: str, value: str, unit: str, reference_range: str,
          flag: { type: 'string', enum: ['high', 'low', 'normal', 'critical', 'unknown'] }, evidence,
        },
        required: ['test', 'value', 'flag', 'evidence'],
      },
    },
    devices: {
      type: 'array',
      items: { type: 'object', properties: { name: str, evidence }, required: ['name', 'evidence'] },
    },
  },
  required: ['allergies', 'conditions', 'medications', 'lab_results', 'devices'],
};

export const PROMPT = `You are extracting facts from a patient's own medical document so they can update their emergency medical profile.
Rules:
- Extract ONLY what the document explicitly states. Never infer, guess or diagnose.
- For every item, copy a short verbatim quote from the document into "evidence" (max 120 characters).
- conditions: diagnoses or problems listed for the patient. status "resolved" only if the document says so; "suspected" only if written as query/possible/rule-out.
- medications: current medications with dose and frequency as written. Set "stopped": true only if the document says it was stopped.
- allergies: drug, food or other allergies, with the reaction if written. If the document says "no known allergies", return an empty list.
- lab_results: each test with value, unit, reference range and flag exactly as the report marks it (H/L/critical). Use "unknown" if no flag or range is given.
- devices: medical devices or therapies the patient depends on (e.g. home oxygen, CPAP, dialysis, insulin pump, pacemaker).
- Use the patient's details only if clearly the patient's (not the doctor's or lab's).
- If something is unreadable or ambiguous, leave it out.`;

function toBase64(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

function findJsonText(node) {
  // The Interactions API returns the model text inside steps/content; generateContent inside candidates/parts.
  if (typeof node === 'string') {
    const t = node.trim();
    if (t.startsWith('{')) {
      try { const v = JSON.parse(t); if (v && typeof v === 'object' && 'medications' in v) return v; } catch { /* keep looking */ }
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) { const v = findJsonText(node[i]); if (v) return v; }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const k of ['output_text', 'text', 'steps', 'content', 'outputs', 'candidates', 'parts']) {
      if (k in node) { const v = findJsonText(node[k]); if (v) return v; }
    }
  }
  return null;
}

async function post(url, key, body, signal) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}

export async function callGemini(bytes, mimeType, { key, model = DEFAULT_MODEL, timeoutMs = 45000 } = {}) {
  const data = toBase64(bytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Interactions API (current)
    const kind = mimeType === 'application/pdf' ? 'document' : 'image';
    let r = await post(`${API}/interactions`, key, {
      model,
      input: [{ type: kind, data, mime_type: mimeType }, { type: 'text', text: PROMPT }],
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
    }, controller.signal);
    let parsed = r.ok ? findJsonText(r.json) : null;
    if (!parsed) {
      // generateContent (older API surface), same schema
      r = await post(`${API}/models/${model}:generateContent`, key, {
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0 },
      }, controller.signal);
      parsed = r.ok ? findJsonText(r.json) : null;
    }
    if (!parsed) throw new Error(`Gemini returned no usable result (HTTP ${r.status}).`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ validation / normalisation
const clean = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function dedupe(items, key) {
  const seen = new Set();
  return items.filter((x) => { const k = key(x).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

export function normalise(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const withEvidence = (x) => clean(x?.evidence).length >= 3;

  const allergies = dedupe(arr(r.allergies).filter(withEvidence).map((a) => ({
    substance: clean(a.substance, 60), reaction: clean(a.reaction, 60), evidence: clean(a.evidence),
  })).filter((a) => a.substance && !/^(none|nkda|no known)/i.test(a.substance)), (a) => a.substance);

  const conditions = dedupe(arr(r.conditions).filter(withEvidence).map((c) => ({
    name: clean(c.name, 80), status: ['active', 'resolved', 'suspected'].includes(c.status) ? c.status : 'active', evidence: clean(c.evidence),
  })).filter((c) => c.name), (c) => c.name);

  const medications = dedupe(arr(r.medications).filter(withEvidence).map((m) => ({
    name: clean(m.name, 60), dose: clean(m.dose, 30), frequency: clean(m.frequency, 40), stopped: m.stopped === true, evidence: clean(m.evidence),
  })).filter((m) => m.name), (m) => m.name);

  const lab_results = dedupe(arr(r.lab_results).filter(withEvidence).map((l) => ({
    test: clean(l.test, 60), value: clean(String(l.value ?? ''), 20), unit: clean(l.unit, 20), reference_range: clean(l.reference_range, 40),
    flag: ['high', 'low', 'normal', 'critical', 'unknown'].includes(l.flag) ? l.flag : 'unknown', evidence: clean(l.evidence),
  })).filter((l) => l.test && l.value), (l) => l.test);

  const devices = dedupe(arr(r.devices).filter(withEvidence).map((d) => ({ name: clean(d.name, 60), evidence: clean(d.evidence) }))
    .filter((d) => d.name), (d) => d.name);

  const p = r.patient && typeof r.patient === 'object' ? r.patient : {};
  const blood = clean(p.blood_group, 4).toUpperCase().replace(/\s+/g, '');
  const age = Number.isInteger(p.age) && p.age >= 0 && p.age <= 130 ? p.age : null;
  const patient = { name: clean(p.name, 80), age, sex: clean(p.sex, 20), blood_group: /^(A|B|AB|O)[+-]$/.test(blood) ? blood : '' };

  return {
    document_type: clean(r.document_type, 60), report_date: clean(r.report_date, 30),
    patient, allergies, conditions, medications, lab_results, devices,
  };
}

// Map to the app's existing form fields (used for first-time autofill).
export function toFormDetails(n) {
  const d = {};
  if (n.patient.name) d.name = n.patient.name;
  if (n.patient.age !== null) d.age = String(n.patient.age);
  if (n.patient.sex) d.gender = { f: 'Female', female: 'Female', m: 'Male', male: 'Male' }[n.patient.sex.toLowerCase()] || n.patient.sex;
  if (n.patient.blood_group) d.blood = n.patient.blood_group;
  const active = n.conditions.filter((c) => c.status !== 'resolved').map((c) => c.name);
  if (n.allergies.length) d.allergies = n.allergies.map((a) => a.substance).join(', ');
  if (active.length) d.conditions = active.join(', ');
  const meds = n.medications.filter((m) => !m.stopped).map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(' '));
  if (meds.length) d.medications = meds.join(', ');
  if (n.devices.length) d.devices = n.devices.map((x) => x.name).join(', ');
  return d;
}
