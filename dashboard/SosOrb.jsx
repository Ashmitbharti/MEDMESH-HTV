import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useClock } from '../ui3d/project';

// The SOS button as a glowing 3D orb (idea from Ashmit's home screen, made 3D): ripples pulse out from it, a tilted
// orbit ring turns around it, and while you hold it the ring fills and the orb heats up. Hold 3 seconds; letting go cancels.

const HOLD_MS = 3000;
const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

export default function SosOrb({ size = 230, disabled, onComplete }) {
  const { t } = useClock(true, 30);
  const [frac, setFrac] = useState(0);
  const timer = useRef(null);

  function start() {
    if (disabled) return;
    const t0 = Date.now();
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      const f = Math.min(1, (Date.now() - t0) / HOLD_MS);
      setFrac(f);
      if (f >= 1) { clearInterval(timer.current); setFrac(0); onComplete?.(); }
    }, 30);
  }
  function stop() {
    clearInterval(timer.current);
    setFrac(0);
  }

  const S = size + 70;                         // room for the ripples
  const cx = S / 2;
  const cy = S / 2;
  const R = size * 0.36;
  const ring = R + 16;
  const circ = 2 * Math.PI * ring;
  const holding = frac > 0;
  const heat = holding ? 0.4 + frac * 0.6 : 0.25 + Math.sin(t * 2.2) * 0.08;
  const left = Math.ceil((1 - frac) * 3);
  const ripples = [0, 0.33, 0.66].map((o) => ((t * (holding ? 1.6 : 0.55) + o) % 1));
  const orbit = t * 0.9;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="I'm in trouble. SOS"
      accessibilityHint="Hold for three seconds to start an emergency request. Release early to cancel."
      accessibilityState={{ disabled: !!disabled }} onPressIn={start} onPressOut={stop}
      style={{ alignItems: 'center', opacity: disabled ? 0.45 : 1 }}>
      <Svg width={S} height={S}>
        <Defs>
          <RadialGradient id="orb" cx="38%" cy="32%" r="70%">
            <Stop offset="0" stopColor="#ffd1dc" stopOpacity="1" />
            <Stop offset="0.25" stopColor="#ff4d6d" stopOpacity="1" />
            <Stop offset="0.75" stopColor="#be123c" stopOpacity="1" />
            <Stop offset="1" stopColor="#4c0519" stopOpacity="1" />
          </RadialGradient>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0.55" stopColor="#f43f5e" stopOpacity={heat} />
            <Stop offset="1" stopColor="#f43f5e" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={S / 2} fill="url(#halo)" />
        {ripples.map((k, i) => (
          <Circle key={i} cx={cx} cy={cy} r={ring + k * (S / 2 - ring)} fill="none" stroke="#fb7185" strokeOpacity={(1 - k) * 0.55} strokeWidth={2} />
        ))}
        {/* tilted orbit ring: the back half is drawn behind the orb, the front half in front */}
        <G rotation={-18} origin={`${cx}, ${cy}`}>
          <Ellipse cx={cx} cy={cy} rx={R * 1.45} ry={R * 0.42} fill="none" stroke="#fecdd3" strokeOpacity={0.25} strokeWidth={1.5} strokeDasharray="3 7" strokeDashoffset={-orbit * 30} />
        </G>
        <Ellipse cx={cx} cy={cy + R * 0.95} rx={R * 0.85} ry={R * 0.16} fill="#000" fillOpacity={0.35} />
        <Circle cx={cx} cy={cy} r={R} fill="url(#orb)" />
        <Ellipse cx={cx - R * 0.28} cy={cy - R * 0.45} rx={R * 0.42} ry={R * 0.2} fill="#fff" fillOpacity={0.35} />
        {(() => {
          const a = orbit;
          const px = cx + Math.cos(a) * R * 1.45;
          const py = cy + Math.sin(a) * R * 0.42;
          const rx = cx + (px - cx) * Math.cos(-0.314) - (py - cy) * Math.sin(-0.314);
          const ry = cy + (px - cx) * Math.sin(-0.314) + (py - cy) * Math.cos(-0.314);
          return Math.sin(a) > 0 ? <Circle cx={rx} cy={ry} r={4.5} fill="#fff" /> : null;
        })()}
        <Circle cx={cx} cy={cy} r={ring} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={6} />
        <Circle cx={cx} cy={cy} r={ring} fill="none" stroke="#fff" strokeWidth={6} strokeLinecap="round"
          strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - frac)} rotation={-90} origin={`${cx}, ${cy}`} />
        <SvgText x={cx} y={cy + (holding ? 14 : 10)} fill="#fff" fontSize={holding ? 52 : 44} fontWeight="900" textAnchor="middle" fontFamily={SANS}>
          {holding ? `${left}` : 'SOS'}
        </SvgText>
        <SvgText x={cx} y={cy + R * 0.58} fill="#ffe4e6" fontSize={12} fontWeight="800" textAnchor="middle" fontFamily={SANS}>
          {holding ? 'KEEP HOLDING' : 'HOLD FOR HELP'}
        </SvgText>
      </Svg>
      <View style={{ alignItems: 'center', marginTop: -24 }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>I’m in trouble</Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 3 }}>
          {holding ? 'Release to cancel' : 'Hold 3 seconds · emergency for you'}
        </Text>
      </View>
    </Pressable>
  );
}
