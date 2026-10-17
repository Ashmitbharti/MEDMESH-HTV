import { useEffect, useState } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, splitPath, toPath, useClock } from '../ui3d/project';
import { c } from '../medmesh-id/theme';

// "The Shield": a glowing 3D dome over the person. Weather from the backdrop hits it and sparks off it,
// lightning lights its rim. Rings around it carry real information:
//   inner ring  = emergency contacts (green once told)
//   outer ring  = nearest hospital / pharmacy / responder, placed by compass bearing
//   ground wave = mesh signal (stronger = brighter, faster)
// Drag to rotate, tilt the phone to look around it, tap it and it pulses.

export const STATUS_COLOR = { calm: c.sky, help: c.amber, safe: c.green };
const SPARK = { storm: '#e0f2fe', rain: '#bae6fd', flood: '#bae6fd', snow: '#ffffff', fire: '#fdba74', quake: '#c4b5fd' };

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

function hash(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

export default function Shield({
  width, height = 300, status = 'calm', kind = 'calm', flashAt = 0, signal = 0.6, places = [], contacts = [], responder,
}) {
  const { t, now } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [tapAt, setTapAt] = useState(0);
  const [gesture] = useState(() => ({ base: 0, live: 0 })); // mutable gesture scratch, not render state

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    let sub;
    DeviceMotion.isAvailableAsync().then((ok) => {
      if (!ok) return;
      DeviceMotion.setUpdateInterval(60);
      sub = DeviceMotion.addListener((m) => {
        const beta = m.rotation?.beta ?? 0.9;
        setTilt(Math.max(-0.18, Math.min(0.18, (beta - 0.9) * 0.35)));
      });
    }).catch(() => {});
    return () => sub?.remove();
  }, []);

  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
    onPanResponderGrant: () => { gesture.base = gesture.live; },
    onPanResponderMove: (_, g) => { gesture.live = gesture.base + g.dx * 0.012; setDrag(gesture.live); },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) { setTapAt(Date.now()); }
    },
  }));

  const col = STATUS_COLOR[status] || c.sky;
  const yaw = t * 0.1 + drag;
  const scale = Math.min(width, 420) * 0.235;
  const P = makeCamera({ cx: width / 2, cy: height * 0.6, scale, yaw, pitch: 0.42 + tilt, dist: 8 });

  // dome wireframe
  const meridians = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 6;
    return splitPath(P, Array.from({ length: 33 }, (_, j) => {
      const ph = (j / 32) * Math.PI;
      return [Math.cos(a) * Math.cos(ph), Math.sin(ph), Math.sin(a) * Math.cos(ph)];
    }));
  });
  const parallels = [0.38, 0.78, 1.15].map((e) => splitPath(P, ring(Math.cos(e), Math.sin(e), 56)));
  const wire = { near: [...meridians, ...parallels].map((m) => m.near).join(''), far: [...meridians, ...parallels].map((m) => m.far).join('') };

  // silhouette: upper half circle + near half of the base ellipse
  const o = P(0, 0, 0);
  const L = P(-1, 0, 0);
  const halfW = Math.abs(o.x - L.x);
  const left = { x: o.x - halfW, y: o.y };
  const right = { x: o.x + halfW, y: o.y };
  const nearBase = ring(1, 0, 48).map((p) => P(...p)).filter((q) => q.z < 0).sort((a, b) => b.x - a.x);
  const silhouette = `M${left.x},${left.y}A${halfW},${halfW * 1.02} 0 0 1 ${right.x},${right.y}${nearBase.map((q) => `L${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('')}L${left.x},${left.y}Z`;

  const sinceFlash = (now - flashAt) / 1000;
  const flash = sinceFlash < 0.6 ? 1 - sinceFlash / 0.6 : 0;
  const sinceTap = (now - tapAt) / 1000;
  const tap = sinceTap < 0.8 ? 1 - sinceTap / 0.8 : 0;
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);

  // ground rings
  const rIn = splitPath(P, ring(1.38));
  const rOut = splitPath(P, ring(1.8));

  // mesh signal wave
  const waveK = (t * (0.25 + signal * 0.35)) % 1;
  const wave = toPath(P, ring(1 + waveK * 1.1));

  // you
  const youPulse = (t * 0.6) % 1;
  const pin = P(0, 0.22, 0);

  // sparks where weather hits the dome
  const sparks = SPARK[kind] ? Array.from({ length: kind === 'storm' ? 9 : 6 }, (_, i) => {
    const period = kind === 'snow' ? 2.4 : kind === 'fire' ? 1.8 : 0.9;
    const cyc = Math.floor((t + i * 0.37) / period);
    const ph = ((t + i * 0.37) % period) / period;
    const az = hash(cyc * 13 + i) * Math.PI * 2;
    const el = 0.45 + hash(cyc * 7 + i * 3) * 1.0;
    const q = P(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    if (q.z > 0.25) return null;
    return { q, ph, key: i };
  }).filter(Boolean) : [];

  const placeAt = (bearing, r, y = 0) => [Math.sin(bearing) * r, y, -Math.cos(bearing) * r];

  // draw places far-to-near
  // nearer places sit closer to the dome; poles take three heights so labels have room
  const ringOf = (p) => (p.km != null ? 1.45 + Math.min(1, p.km / 6) * 0.75 : 1.8);
  // only the nearest few carry a text label (the rest show their symbol), so a crowded side stays readable
  const byKm = [...places].sort((a, b) => (a.km ?? 0) - (b.km ?? 0)).map((p) => p.label);
  const items = places.map((p, i) => ({ ...p, quiet: byKm.indexOf(p.label) >= 3,
    g: P(...placeAt(p.bearing, ringOf(p))), top: P(...placeAt(p.bearing, ringOf(p), 0.42 + (i % 3) * 0.36)) }))
    .sort((a, b) => b.g.z - a.g.z);
  // keep labels from overlapping when two places lie in the same direction
  [...items].filter((x) => !x.quiet).sort((a, b) => b.top.y - a.top.y).forEach((it, i, arr) => {
    it.ly = it.top.y - 17 * it.top.k;
    if (i && it.ly > arr[i - 1].ly - 14 && Math.abs(it.top.x - arr[i - 1].top.x) < 120) it.ly = arr[i - 1].ly - 14; // move the higher one up
  });

  let amb = null;
  if (responder) {
    const k = Math.min(1, ((t * 0.06) % 1.1));
    const r = 1.8 - k * 0.7;
    amb = { g: P(...placeAt(responder.bearing, r)), top: P(...placeAt(responder.bearing, r, 0.32)) };
  }

  return (
    <View style={{ width, height }} {...pan.panHandlers} accessible accessibilityRole="button"
      accessibilityLabel={`Your MedMesh shield. Status: ${status}. Drag to rotate, tap for details.`}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="domeFill" cx="50%" cy="35%" r="65%">
            <Stop offset="0" stopColor={col} stopOpacity={0.30 + tap * 0.25 + flash * 0.3} />
            <Stop offset="0.7" stopColor={col} stopOpacity={0.08 + flash * 0.1} />
            <Stop offset="1" stopColor={col} stopOpacity={0.02} />
          </RadialGradient>
          <RadialGradient id="floorGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={col} stopOpacity={0.28} />
            <Stop offset="1" stopColor={col} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="spot" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="0.4" stopColor={col} stopOpacity="0.6" />
            <Stop offset="1" stopColor={col} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* floor */}
        <Path d={`${toPath(P, ring(2.1))}Z`} fill="url(#floorGlow)" />
        <Path d={rOut.far} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} fill="none" />
        <Path d={rOut.near} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={1} fill="none" strokeDasharray="2 5" />
        <Path d={rIn.far} stroke={col} strokeOpacity={0.12} strokeWidth={1} fill="none" />
        <Path d={rIn.near} stroke={col} strokeOpacity={0.28} strokeWidth={1} fill="none" />
        <Path d={wave} stroke={col} strokeOpacity={(1 - waveK) * (0.25 + signal * 0.45)} strokeWidth={1.5} fill="none" />

        {/* places behind the dome */}
        {items.filter((p) => p.g.z > 0).map((p) => <Place key={p.label} p={p} width={width} />)}

        {/* back of the dome */}
        <Path d={wire.far} stroke={col} strokeOpacity={0.10 + flash * 0.2} strokeWidth={1} fill="none" />

        {/* you */}
        {[0, 0.5].map((off) => {
          const k = (youPulse + off) % 1;
          return <Path key={off} d={toPath(P, ring(0.12 + k * 0.7))} stroke={col} strokeOpacity={(1 - k) * 0.6} strokeWidth={1.2} fill="none" />;
        })}
        <Line x1={o.x} y1={o.y} x2={pin.x} y2={pin.y} stroke={col} strokeWidth={2} strokeOpacity={0.8} />
        <Circle cx={pin.x} cy={pin.y} r={16} fill="url(#spot)" />
        <Circle cx={pin.x} cy={pin.y} r={5} fill="#ffffff" />
        <SvgText x={pin.x} y={pin.y - 14} fill="#ffffff" fontSize={9.5} fontWeight="800" textAnchor="middle" fontFamily={SANS} letterSpacing="1.4">YOU</SvgText>

        {/* contacts on the inner ring */}
        {contacts.map((ct, i) => {
          const a = 0.9 + i * 0.85;
          const g = P(Math.cos(a) * 1.38, 0, Math.sin(a) * 1.38);
          const color = ct.told ? c.green : '#94a3b8';
          return (
            <G key={ct.name + i} opacity={g.z > 0.3 ? 0.5 : 1}>
              <Circle cx={g.x} cy={g.y} r={9 * g.k} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.2} />
              <SvgText x={g.x} y={g.y + 3.4 * g.k} fill={color} fontSize={9 * g.k} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{ct.initials}</SvgText>
            </G>
          );
        })}

        {/* dome glass + front wire + rim */}
        <Path d={silhouette} fill="url(#domeFill)" />
        <Path d={wire.near} stroke={col} strokeOpacity={0.30 + breathe * 0.12 + flash * 0.4} strokeWidth={1.1} fill="none" />
        <Path d={`M${left.x},${left.y}A${halfW},${halfW * 1.02} 0 0 1 ${right.x},${right.y}`} stroke={flash ? '#ffffff' : col}
          strokeOpacity={0.55 + breathe * 0.25 + flash * 0.45} strokeWidth={2 + flash * 2.5} fill="none" />

        {/* weather impacts */}
        {sparks.map(({ q, ph, key }) => (
          <G key={key}>
            <Circle cx={q.x} cy={q.y} r={1.5 + ph * 9} stroke={SPARK[kind]} strokeOpacity={(1 - ph) * 0.8} strokeWidth={1.2} fill="none" />
            <Circle cx={q.x} cy={q.y} r={1.6} fill={SPARK[kind]} fillOpacity={1 - ph} />
          </G>
        ))}

        {/* responder coming in */}
        {amb ? (
          <G>
            <Line x1={amb.g.x} y1={amb.g.y} x2={amb.top.x} y2={amb.top.y} stroke={c.amber} strokeWidth={1.5} />
            <Circle cx={amb.top.x} cy={amb.top.y} r={13 * amb.top.k} fill={c.amber} fillOpacity={0.2} stroke={c.amber} strokeWidth={1.5} />
            <SvgText x={amb.top.x} y={amb.top.y + 3.5} fill={c.amber} fontSize={10} fontWeight="900" textAnchor="middle" fontFamily={SANS}>EMS</SvgText>
            <SvgText x={amb.top.x} y={amb.top.y - 18} fill="#fde68a" fontSize={10} fontWeight="700" textAnchor="middle" fontFamily={SANS}>{responder.label}</SvgText>
          </G>
        ) : null}

        {/* places in front */}
        {items.filter((p) => p.g.z <= 0).map((p) => <Place key={p.label} p={p} width={width} />)}
      </Svg>
    </View>
  );
}

function Place({ p, width }) {
  const dim = p.g.z > 0 ? 0.6 : 1;
  const text = p.sub ? `${p.label} · ${p.sub}` : p.label;
  const half = text.length * 2.9 + 6;                          // keep the label on screen
  const lx = Math.max(half, Math.min(width - half, p.top.x));
  return (
    <G opacity={dim}>
      <Circle cx={p.g.x} cy={p.g.y} r={3 * p.g.k} fill={p.color} />
      <Line x1={p.g.x} y1={p.g.y} x2={p.top.x} y2={p.top.y} stroke={p.color} strokeOpacity={0.7} strokeWidth={1.4} />
      <Circle cx={p.top.x} cy={p.top.y} r={12 * p.top.k} fill="#0b1020" fillOpacity={0.85} stroke={p.color} strokeWidth={1.4} />
      <SvgText x={p.top.x} y={p.top.y + 4 * p.top.k} fill={p.color} fontSize={(p.glyph.length > 1 ? 9 : 14) * p.top.k} fontWeight="900" textAnchor="middle" fontFamily={SANS}>{p.glyph}</SvgText>
      {p.quiet ? null : <SvgText x={lx} y={p.ly} fill="#e5e7eb" fontSize={10} fontWeight="700" textAnchor="middle" fontFamily={SANS}>{text}</SvgText>}
    </G>
  );
}
