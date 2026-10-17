import { extractText, getDocumentProxy } from 'npm:unpdf@1.4.0';
import { extractDetails } from './extractDetails.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function reply(body, status = 200) {
  return Response.json(body, { status, headers });
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

  const maxSize = 5 * 1024 * 1024;
  const length = Number(request.headers.get('content-length'));
  if (length > maxSize + 65536) return reply({ error: 'Choose a PDF smaller than 5 MB.' }, 413);

  try {
    const form = await request.formData();
    const file = form.get('report');
    if (!(file instanceof File) || file.type !== 'application/pdf') {
      return reply({ error: 'Choose a PDF file.' }, 400);
    }
    if (!file.size || file.size > maxSize) {
      return reply({ error: 'Choose a non-empty PDF smaller than 5 MB.' }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      return reply({ error: 'This file is not a valid PDF.' }, 400);
    }

    const pdf = await getDocumentProxy(bytes);
    try {
      if (pdf.numPages > 20) return reply({ error: 'Choose a report with 20 pages or fewer.' }, 400);
      const { text } = await extractText(pdf, { mergePages: true });
      if (!text.trim()) {
        return reply({ error: 'This PDF has no readable text. Scanned reports need OCR; please fill in the form manually.' }, 422);
      }

      return reply({ details: extractDetails(text) });
    } finally {
      await pdf.destroy();
    }
  } catch {
    return reply({ error: 'Could not read this PDF. It may be password-protected or damaged.' }, 422);
  }
});
