import { Platform } from 'react-native';
import { getSession } from '../lib/supabase';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function readReport(asset) {
  if (!url || !key) {
    throw new Error('Reading reports needs Supabase setup first. You can still fill in the form manually.');
  }

  const session = await getSession();

  const body = new FormData();
  body.append('report', Platform.OS === 'web' ? asset.file : {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType || 'application/pdf',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${url}/functions/v1/pdf-autofill`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
      body,
      signal: controller.signal,
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.details) {
      throw new Error(result?.error || 'Could not read this report. Check that the pdf-autofill function is deployed.');
    }

    // { source: 'gemini' | 'text-rules', model, details, extracted }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Reading the report took too long. Please try again.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
