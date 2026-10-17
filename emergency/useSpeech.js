import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Speak instead of typing. On the web (Chrome/Edge/Safari) this uses the browser's speech recognition, which
// needs that browser's speech service. On a phone app, the keyboard's own microphone does the same job.
function Recognizer() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useSpeech(onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef(null);
  const supported = !!Recognizer();

  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* already stopped */ } }, []);

  const start = useCallback((base = '') => {
    const R = Recognizer();
    if (!R) { setError('Speaking is not available in this browser. Use the microphone on your keyboard.'); return; }
    setError('');
    const r = new R();
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      onText((base ? `${base.trim()} ` : '') + said.trim());
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Allow the microphone to speak your report.'
      : e.error === 'network' ? 'Speaking needs internet in this browser. Type instead, or use your keyboard microphone.' : '');
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [onText]);

  useEffect(() => stop, [stop]);
  return { supported, listening, error, start, stop };
}
