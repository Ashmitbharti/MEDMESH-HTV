import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { createAudioPlayer } from 'expo-audio';
import Svg, { Circle, Defs, Ellipse, G, Line, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Ambulance, Pause, Play, Volume2, VolumeX, X } from 'lucide-react-native';
import { mono } from '../medmesh-id/theme';
import { CPR_COACH } from './content';
import { line, loadPack } from './pack';
import { say, stopVoice } from './voice';
import { useMesh } from '../link/meshLink';
import { isOpen, loadScene } from '../emergency/sceneService';
import { caseStatus, etaLeft } from '../status/caseStatus';

// CPR coach: a beat at 110 per minute (sound + vibration), a 3D chest target that compresses on every beat,
// and a voice (the person's own language, prepared by Gemini and saved on the phone) talking them through it.
const BPM = 110;
const MS = 60000 / BPM;
const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

// Beat sound: Web Audio on the web preview, a bundled click on phones
let ctx = null;
let clickPlayer = null;
function click() {
  if (Platform.OS === 'web') {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1150;
      g.gain.setValueAtTime(0.35, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.06);
    } catch { /* no audio */ }
    return;
  }
  try {
    clickPlayer = clickPlayer || createAudioPlayer(require('../assets/sounds/beat.wav'));
    clickPlayer.seekTo(0);
    clickPlayer.play();
  } catch { /* no audio */ }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

function Chest({ size, beatAt, now }) {
  const k = Math.max(0, 1 - (now - beatAt) / 260);          // 1 right on the beat, decays
  const press = Math.sin(Math.min(1, k) * Math.PI / 2);
  const cx = size / 2;
  const cy = size * 0.56;
  return (
    <Svg width={size} height={size * 0.92}>
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#fb7185" stopOpacity={0.55 + press * 0.35} />
          <Stop offset="1" stopColor="#fb7185" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy + 18} rx={size * 0.46} ry={size * 0.17} fill="url(#glow)" />
      {[0, 1, 2, 3].map((i) => {
        const s = 1 - press * 0.07 * (4 - i);
        return <Ellipse key={i} cx={cx} cy={cy + press * 6} rx={size * (0.12 + i * 0.09) * s} ry={size * (0.045 + i * 0.033) * s} stroke="#fda4af" strokeOpacity={0.75 - i * 0.15} strokeWidth={i === 0 ? 2.5 : 1.5} fill="none" />;
      })}
      <Ellipse cx={cx} cy={cy + (1 - k) * 0 + 18} rx={size * (0.12 + (1 - k) * 0.3)} ry={size * (0.045 + (1 - k) * 0.11)} stroke="#fecdd3" strokeOpacity={k * 0.8} fill="none" />
      <G transform={`translate(0 ${press * size * 0.05})`}>
        {/* rescuer seen from the front: head, shoulders, straight locked arms down to the hands */}
        <Circle cx={cx} cy={cy - size * 0.47} r={size * 0.055} fill="#fff" fillOpacity={0.9} />
        <Rect x={cx - size * 0.15} y={cy - size * 0.4} width={size * 0.3} height={size * 0.07} rx={size * 0.035} fill="#fff" fillOpacity={0.85} />
        <Line x1={cx - size * 0.12} y1={cy - size * 0.36} x2={cx - 14} y2={cy - size * 0.1} stroke="#fff" strokeWidth={size * 0.045} strokeLinecap="round" />
        <Line x1={cx + size * 0.12} y1={cy - size * 0.36} x2={cx + 14} y2={cy - size * 0.1} stroke="#fff" strokeWidth={size * 0.045} strokeLinecap="round" />
        <Rect x={cx - size * 0.13} y={cy - size * 0.12} width={size * 0.26} height={size * 0.075} rx={size * 0.035} fill="#fff" fillOpacity={0.85} />
        <Rect x={cx - size * 0.15} y={cy - size * 0.06} width={size * 0.3} height={size * 0.085} rx={size * 0.04} fill="#fff" />
      </G>
      <Circle cx={cx} cy={cy + 2} r={4 + press * 4} fill="#be123c" />
      <SvgText x={size * 0.88} y={cy + 4 + press * 6} fill="#fecdd3" fontSize={13} fontWeight="800" textAnchor="middle" fontFamily={SANS}>5 cm</SvgText>
      <Line x1={size * 0.82} y1={cy - 16} x2={size * 0.82} y2={cy + 16 + press * 6} stroke="#fecdd3" strokeWidth={1.5} />
    </Svg>
  );
}

export default function CprCoach() {
  useKeepAwake(); // the screen must not sleep during CPR
  const { width } = useWindowDimensions();
  const [pack, setPack] = useState(null);
  const [running, setRunning] = useState(true);
  const [muted, setMuted] = useState(false);
  const [count, setCount] = useState(0);
  const [beatAt, setBeatAt] = useState(0);
  const [now, setNow] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [caption, setCaption] = useState('');
  const [scene, setScene] = useState(null);
  const { inbox, outbox } = useMesh();
  const coachIdx = useRef(0);
  const lastVoice = useRef(0);

  useFocusEffect(useCallback(() => {
    loadPack().then(setPack);
    loadScene().then((s) => setScene(isOpen(s) ? s : null));
    setStartedAt(Date.now());
    return () => stopVoice();
  }, []));

  // the beat
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      click();
      setBeatAt(t);
      setCount((v) => v + 1);
    }, MS);
    return () => clearInterval(id);
  }, [running]);

  // animation clock
  useEffect(() => {
    let raf;
    const loop = () => { setNow(Date.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // the voice: instructions first, then a short coaching line every ~15 s, "switch" every 2 min
  const speak = useCallback((id) => {
    setCaption(line(pack, id));
    if (!muted) say(pack, id);
    lastVoice.current = Date.now();
  }, [pack, muted]);
  useEffect(() => {
    if (!running || !startedAt) return;
    const el = (now - startedAt) / 1000;
    const since = (now - lastVoice.current) / 1000;
    if (el < 0.5 && !lastVoice.current) { speak('cpr2'); return; }
    if (lastVoice.current && since > 7 && el < 16 && caption === line(pack, 'cpr2')) { speak('cpr3'); return; }
    if (since > 15) {
      const twoMin = Math.floor(el / 120) > Math.floor((el - since) / 120) && el > 100;
      if (twoMin) speak('cc5');
      else { speak(CPR_COACH[coachIdx.current % 4][0]); coachIdx.current += 1; }
    }
  }, [now, running, startedAt, speak, caption, pack]);

  const el = startedAt && now ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mm = String(Math.floor(el / 60)).padStart(1, '0');
  const ss = String(el % 60).padStart(2, '0');
  const cycle = (count % 30) || (count ? 30 : 0);

  // ambulance ETA if a report is out
  const ids = scene ? Object.values(scene.sent || {}) : [];
  const st = ids.length ? caseStatus(ids[0], inbox, outbox) : null;
  const eta = st && now ? etaLeft(st.etaAt, now) : null;
  const size = Math.min(width - 32, 380);

  return (
    <View style={{ flex: 1, backgroundColor: '#12040a' }}>
      <LinearGradient colors={['#4c0519', '#12040a']} style={{ position: 'absolute', inset: 0, top: 0, left: 0, right: 0, bottom: 0 }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6 }}>
          <Text style={{ color: '#fecdd3', fontFamily: mono, fontSize: 11, letterSpacing: 2, fontWeight: '800', flex: 1 }}>CPR COACH · {BPM} / MIN</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="End CPR coach" onPress={() => { stopVoice(); router.back(); }} hitSlop={10}
            style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>

        {eta != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(251,191,36,0.14)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' }}>
            <Ambulance size={16} color="#fde68a" />
            <Text style={{ color: '#fde68a', fontWeight: '800' }}>Ambulance about {eta} min away · keep going</Text>
          </View>
        ) : null}

        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <Chest size={size} beatAt={beatAt} now={now} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: -2 }}>{cycle}</Text>
            <Text style={{ color: '#fecdd3', fontSize: 12, fontWeight: '700' }}>PUSHES</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: -2 }}>{mm}:{ss}</Text>
            <Text style={{ color: '#fecdd3', fontSize: 12, fontWeight: '700' }}>{el >= 110 && el % 120 > 110 ? 'SWITCH SOON' : 'ELAPSED'}</Text>
          </View>
        </View>

        <View style={{ marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(253,164,175,0.25)', minHeight: 92 }}>
          <Text style={{ color: '#fff', fontSize: 20, lineHeight: 27, fontWeight: '700', textAlign: 'center' }}>{caption || line(pack, 'cpr3')}</Text>
          {pack?.source === 'gemini' ? <Text style={{ color: '#fda4af', fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>Voice in {pack.languageName} · prepared by Gemini · playing offline</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 }}>
          <Pressable accessibilityRole="button" onPress={() => setRunning((v) => !v)} style={{ flex: 1, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: running ? 'rgba(255,255,255,0.1)' : '#e11d48' }}>
            {running ? <Pause size={20} color="#fff" /> : <Play size={20} color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{running ? 'Pause beat' : 'Resume'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn voice on' : 'Mute voice'} onPress={() => { if (!muted) stopVoice(); setMuted((v) => !v); }}
            style={{ width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' }}>
            {muted ? <VolumeX size={20} color="#fff" /> : <Volume2 size={20} color="#fff" />}
          </Pressable>
        </View>
        <Text style={{ color: 'rgba(254,205,211,0.6)', fontSize: 11.5, textAlign: 'center', marginTop: 10, paddingHorizontal: 24 }}>
          {"Push with the beat. Don't stop until paramedics take over or the person starts breathing."}
        </Text>
      </SafeAreaView>
    </View>
  );
}
