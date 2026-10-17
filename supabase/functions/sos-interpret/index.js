import { normalise } from '../_shared/sosLogic.js';

// "Tell us in your own words" (any language) -> MedMesh emergency form, using Gemini with a fixed JSON schema.
// Secret: supabase secrets set GEMINI_API_KEY=...   (never put the key in the app)
const API = 'https://generativelanguage.googleapis.com/v1beta';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const YNU = { type: 'string', enum: ['yes', 'no', 'unknown'] };
const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string' }, translation_en: { type: 'string' }, summary: { type: 'string' },
    incident_type: { type: 'string', enum: ['crash', 'fall', 'fire', 'flood', 'collapse', 'violence', 'medical', 'other', 'unknown'] },
    location_text: { type: 'string' }, count: { type: 'integer' }, caller_is_patient: { type: 'boolean' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' }, age_group: { type: 'string', enum: ['child', 'adult', 'senior', 'unknown'] },
          walk: YNU, breathing: { type: 'string', enum: ['normal', 'fast', 'none', 'unknown'] }, responds: YNU, bleeding: YNU,
          complaint: { type: 'string', enum: ['CP', 'BR', 'BL', 'BU', 'UN', 'PR', 'FX', 'OT'] }, trapped: { type: 'boolean' },
          note: { type: 'string' }, evidence: { type: 'string' },
        },
        required: ['age_group', 'walk', 'breathing', 'responds', 'bleeding', 'complaint', 'evidence'],
      },
    },
  },
  required: ['language', 'translation_en', 'summary', 'incident_type', 'count', 'people'],
};
const PROMPT = `You help a bystander in a disaster report an emergency. They may be panicking and may use any language.
Fill the form ONLY from what they said; anything not mentioned is "unknown". Never guess, never diagnose.
One entry in "people" per injured person mentioned, most serious first. complaint codes: CP chest pain, BR breathing,
BL bleeding/injury, BU burn, UN unconscious/not responding, PR pregnancy/labour, FX fall/broken bone, OT other.
breathing "none" only if they say not breathing. bleeding = heavy bleeding. evidence = a few of their own words.
translation_en: faithful English translation. summary: one line for a dispatcher.`;

const reply = (body, status = 200) => Response.json(body, { status, headers });

async function gemini(text, key, model) {
  const parts = [{ text: `What the caller said:\n${text}` }, { text: PROMPT }];
  for (const cfg of ['responseJsonSchema', 'responseSchema']) {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', [cfg]: SCHEMA, temperature: 0 } }),
    });
    if (r.ok) {
      const j = await r.json();
      const raw = j?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || '';
      const m = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : raw);
    }
    if (r.status !== 400) throw new Error(`Gemini HTTP ${r.status}`);
  }
  throw new Error('Gemini rejected the request');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in first.' }, 401);
  const auth = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') } });
  if (!auth.ok) return reply({ error: 'Your session expired.' }, 401);
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return reply({ error: 'Gemini key not set on the server.' }, 503);
  try {
    const { text } = await req.json();
    const words = String(text || '').trim().slice(0, 2000);
    if (!words) return reply({ error: 'Nothing to read.' }, 400);
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
    return reply({ source: 'gemini', model, result: normalise(await gemini(words, key, model)) });
  } catch (e) {
    console.error('sos-interpret', e?.message);
    return reply({ error: 'Could not read that right now.' }, 502);
  }
});
