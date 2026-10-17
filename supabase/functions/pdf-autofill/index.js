import { extractText, getDocumentProxy } from 'npm:unpdf@1.4.0';
import { extractDetails } from './extractDetails.js';
import { callGemini, normalise, toFormDetails, DEFAULT_MODEL } from './gemini.js';

// Reads a checkup report and returns facts for the MedMesh profile.
//   With GEMINI_API_KEY set (supabase secrets set GEMINI_API_KEY=...): Gemini reads PDFs AND photos of reports,
//   returning allergies, conditions, medications, lab results and devices, each with a verbatim quote.
//   Without it: the original text rules read labelled fields from text PDFs.
// The report is processed in memory and never stored.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function reply(body, status = 200) {
  return Response.json(body, { status, headers });
}

async function textRules(bytes) {
  const pdf = await getDocumentProxy(bytes);
  try {
    if (pdf.numPages > 20) return { error: 'Choose a report with 20 pages or fewer.', status: 400 };
    const { text } = await extractText(pdf, { mergePages: true });
    if (!text.trim()) {
      return { error: 'This PDF has no readable text. Add a Gemini key to read scanned reports, or fill in the form manually.', status: 422 };
    }
    return { body: { source: 'text-rules', details: extractDetails(text), extracted: null } };
  } finally {
    await pdf.destroy();
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in first.' }, 401);

  const auth = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') },
  });
  if (!auth.ok) return reply({ error: 'Your session expired. Try again.' }, 401);

  const maxSize = 8 * 1024 * 1024;
  const length = Number(request.headers.get('content-length'));
  if (length > maxSize + 65536) return reply({ error: 'Choose a file smaller than 8 MB.' }, 413);

  try {
    const form = await request.formData();
    const file = form.get('report');
    if (!(file instanceof File) || !TYPES.includes(file.type)) {
      return reply({ error: 'Choose a PDF or a photo (JPG or PNG) of your report.' }, 400);
    }
    if (!file.size || file.size > maxSize) return reply({ error: 'Choose a non-empty file smaller than 8 MB.' }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === 'application/pdf' && new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      return reply({ error: 'This file is not a valid PDF.' }, 400);
    }

    const key = Deno.env.get('GEMINI_API_KEY');
    if (key) {
      const model = Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL;
      try {
        const extracted = normalise(await callGemini(bytes, file.type, { key, model }));
        return reply({ source: 'gemini', model, details: toFormDetails(extracted), extracted });
      } catch (error) {
        console.error('gemini failed', error?.message);
        if (file.type !== 'application/pdf') {
          return reply({ error: 'Could not read this photo right now. Try again, or fill in the details manually.' }, 502);
        }
        // fall through to the text rules for text PDFs
      }
    } else if (file.type !== 'application/pdf') {
      return reply({ error: 'Reading photos needs the Gemini key on the server. Upload a PDF or fill in manually.' }, 422);
    }

    const out = await textRules(bytes);
    return out.error ? reply({ error: out.error }, out.status) : reply(out.body);
  } catch {
    return reply({ error: 'Could not read this report. It may be password-protected or damaged.' }, 422);
  }
});
