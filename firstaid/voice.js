import * as Speech from 'expo-speech';
import { createAudioPlayer } from 'expo-audio';
import { clipUri } from './audioStore';
import { langCode } from './content';
import { line } from './pack';

// Speak one line of the pack: the Gemini voice clip saved on the phone if there is one, otherwise the phone's
// built-in voice in the pack's language (works offline on most phones). Returns when speech has (roughly) ended.
let player = null;

export function stopVoice() {
  Speech.stop();
  try { player?.pause(); player?.remove(); } catch { /* ignore */ }
  player = null;
}

export async function say(pack, id, { onDone } = {}) {
  stopVoice();
  const ref = pack?.audio?.[id];
  const uri = ref ? await clipUri(ref) : null;
  if (uri) {
    try {
      player = createAudioPlayer({ uri });
      const sub = player.addListener('playbackStatusUpdate', (st) => { if (st.didJustFinish) { sub.remove(); onDone?.(); } });
      player.play();
      return 'gemini';
    } catch { /* fall through to the phone's voice */ }
  }
  const t = line(pack, id);
  if (!t) return null;
  Speech.speak(t, { language: pack?.text?.[id]?.english ? 'en' : langCode(pack?.language), rate: 0.95, onDone });
  return 'device';
}
