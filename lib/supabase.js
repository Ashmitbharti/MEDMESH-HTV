import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client;
let signingIn;

async function fetchWithTimeout(input, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 15000);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function getSupabase() {
  if (!url || !key) throw new Error('Add your Supabase URL and publishable key to .env, then restart Expo.');
  if (!client) {
    client = createClient(url, key, {
      global: { fetch: fetchWithTimeout },
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export async function getSession() {
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const supabase = getSupabase();
    const { data: stored, error: storedError } = await supabase.auth.getSession();
    if (storedError) throw storedError;
    if (stored.session && stored.session.expires_at * 1000 > Date.now() + 60000) {
      return stored.session;
    }
    const { data, error } = stored.session
      ? await supabase.auth.refreshSession()
      : await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      throw new Error('Could not connect to Supabase. Check your internet and anonymous sign-in setting.');
    }
    return data.session;
  })();
  try {
    return await signingIn;
  } finally {
    signingIn = null;
  }
}
