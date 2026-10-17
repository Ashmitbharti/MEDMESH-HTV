// Personal offline emergency pack, for phones that are online but cannot reach the command centre.
// Same contract as the command centre's /api/pack. Gemini only translates and voices MedMesh's checked English
// lines; a line whose numbers change is replaced by the English original. Secret: GEMINI_API_KEY.
const API = 'https://generativelanguage.googleapis.com/v1beta';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (b, status = 200) => Response.json(b, { status, headers });
const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, back: { type: 'string' } }, required: ['id', 'text', 'back'] } } },
  required: ['items'],
};
// digits in any common script (Devanagari, Gurmukhi, Tamil, Arabic-Indic, ...) -> 0-9, so numbers can be compared
const ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xff10];
const toAscii = (t) => [...String(t || '')].map((ch) => {
  const cp = ch.codePointAt(0);
  const z = ZEROS.find((x) => cp >= x && cp <= x + 9);
  return z === undefined ? ch : String(cp - z);
}).join('');
const nums = (t) => (toAscii(t).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')).sort().join('|');
const check = (src, it) => !!it?.text?.trim() && nums(it.text) === nums(src) && nums(it.back) === nums(src);

async function post(url, key, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
}

function wav(pcm, rate = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => [...s].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true);
  h.setUint16(22, 1, true); h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44); return out;
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in first.' }, 401);
  const auth = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') } });
  if (!auth.ok) return reply({ error: 'Your session expired.' }, 401);
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return reply({ error: 'Gemini key not set on the server.' }, 503);
  try {
    const { language = 'English', items = [], voice = [] } = await req.json();
    const lines = items.slice(0, 120).map((i) => ({ id: String(i.id), text: String(i.text).slice(0, 400) }));
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
    const english = /^(en|english)?$/i.test(language.trim());
    let tr = {};
    if (!english) {
      const prompt = `Translate these first-aid instructions into ${language} for someone in an emergency. Translate faithfully: do NOT add, remove, soften or change any step, warning or number; keep every number as digits; use simple calm words. For each line also give "back": your translation translated back into plain English, literally.\nLines (JSON):\n${JSON.stringify(lines)}`;
      const r = await post(`${API}/models/${model}:generateContent`, key, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0 } });
      const raw = r?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || '{}';
      for (const it of JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]).items || []) tr[it.id] = it;
    }
    const out = { language, source: 'gemini', model, items: [], audio: {}, checks: { passed: 0, fallback: [] } };
    for (const l of lines) {
      const it = tr[l.id];
      if (english) out.items.push({ ...l, back: l.text, ok: true });
      else if (check(l.text, it)) { out.items.push({ id: l.id, text: it.text.trim(), back: it.back.trim(), ok: true }); out.checks.passed += 1; }
      else { out.items.push({ ...l, back: it?.back || '', ok: false, english: true }); out.checks.fallback.push(l.id); }
    }
    const tts = Deno.env.get('GEMINI_TTS_MODEL') || 'gemini-2.5-flash-preview-tts';
    await Promise.all(out.items.filter((x) => voice.includes(x.id)).map(async (x) => {
      try {
        const r = await post(`${API}/models/${tts}:generateContent`, key, {
          contents: [{ parts: [{ text: `Say calmly and clearly, like a kind paramedic: ${x.text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        });
        const d = r?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        const pcm = Uint8Array.from(atob(d.data), (ch) => ch.charCodeAt(0));
        const rate = Number((d.mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
        out.audio[x.id] = b64(wav(pcm, rate));
      } catch { /* this line uses the phone's own voice */ }
    }));
    return reply(out);
  } catch (e) {
    console.error('emergency-pack', e?.message);
    return reply({ error: 'Could not build the pack right now.' }, 502);
  }
});
