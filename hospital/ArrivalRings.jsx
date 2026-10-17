import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, toPath, useClock } from '../ui3d/project';
import { TRIAGE } from './hospitalService';

// "Arrival rings": the hospital is the tower in the middle; every ring is minutes away (5 / 10 / 20 / 30).
// Each incoming patient is a glowing orb on the ring for their ETA, coloured by the command centre's triage, and
// it slides inwards as the ambulance gets closer. Picked-up patients carry a beam (an ambulance has them).
// Drag to turn the view; tap an orb to open that patient.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const RINGS = [5, 10, 20, 30];
const radius = (m) => 0.35 + 2.45 * Math.sqrt(Math.min(Math.max(m, 0), 36) / 36);
const angle = (id) => {           // FNV-1a: a stable direction per patient
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
};

export default function ArrivalRings({ width, height = 300, patients, selected, onSelect, color = '#7dd3fc' }) {
  const { t, now } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * 0.01; setDrag(g.live); },
  }));
  const yaw = t * 0.06 + drag;
  const P = makeCamera({ cx: width / 2, cy: height * 0.5, scale: Math.min(width * 0.165, 70), yaw, pitch: 0.72, dist: 7 });

  const live = patients.filter((p) => p.phase !== 'away');
  const orbs = [...live].sort((x, y) => (x.id < y.id ? -1 : 1)).map((p, i) => {
    const exact = Math.max(0, (p.arriveAt - now) / 60000);
    const r = p.phase === 'arrived' ? 0.25 : radius(exact);
    const a = angle(p.id) + i * 0.85;                 // patients from one scene share an ETA: fan them out
    const bob = Math.sin(t * 2 + a * 3) * 0.04;
    const ground = P(Math.cos(a) * r, 0, Math.sin(a) * r);
    const up = P(Math.cos(a) * r, 0.22 + bob, Math.sin(a) * r);
    return { p, ground, up, depth: up.z };
  }).sort((x, y) => y.depth - x.depth);

  const tower = [P(0, 0, 0), P(0, 0.9, 0)];
  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="floor" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.16" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {[[10, 10, 1, 1], [width - 10, 10, -1, 1], [10, height - 10, 1, -1], [width - 10, height - 10, -1, -1]].map(([x, y, sx, sy], i) => (
          <Path key={i} d={`M${x},${y + sy * 18}L${x},${y}L${x + sx * 18},${y}`} stroke={color} strokeOpacity={0.5} strokeWidth={1.5} fill="none" />
        ))}
        <Path d={toPath(P, ring(radius(36), 0, 80))} fill="url(#floor)" stroke="none" />
        {RINGS.map((m) => {
          const pts = ring(radius(m), 0, 80);
          const lab = P(0, 0, -radius(m));
          return (
            <G key={m}>
              <Path d={toPath(P, pts)} stroke={color} strokeOpacity={m === 5 ? 0.6 : 0.28} strokeWidth={m === 5 ? 1.6 : 1} strokeDasharray={m === 5 ? undefined : '3 5'} fill="none" />
              <SvgText x={lab.x} y={lab.y - 3} fill={color} fillOpacity={0.7} fontSize={9.5} fontWeight="700" textAnchor="middle" fontFamily={SANS}>{m} min</SvgText>
            </G>
          );
        })}
        {/* sweep */}
        {(() => {
          const a = (t * 0.9) % (Math.PI * 2);
          const e = P(Math.cos(a) * radius(36), 0, Math.sin(a) * radius(36));
          return <Line x1={tower[0].x} y1={tower[0].y} x2={e.x} y2={e.y} stroke={color} strokeOpacity={0.35} strokeWidth={1.5} />;
        })()}
        {/* hospital */}
        <Line x1={tower[0].x} y1={tower[0].y} x2={tower[1].x} y2={tower[1].y} stroke="#fca5a5" strokeWidth={6} strokeLinecap="round" strokeOpacity={0.85} />
        <Rect x={tower[1].x - 7} y={tower[1].y - 7} width={14} height={14} rx={3} fill="#fca5a5" />
        <Path d={`M${tower[1].x - 4},${tower[1].y}H${tower[1].x + 4}M${tower[1].x},${tower[1].y - 4}V${tower[1].y + 4}`} stroke="#7f1d1d" strokeWidth={2} />
        {orbs.map(({ p, ground, up }) => {
          const col = TRIAGE[p.triage]?.color || color;
          const on = selected === p.id;
          const pulse = 0.5 + Math.sin(t * 4 + angle(p.id)) * 0.25;
          const rr = (on ? 11 : 8.5) * Math.min(1.25, up.k);
          return (
            <G key={p.id} onPress={() => onSelect?.(p.id)}>
              <Line x1={ground.x} y1={ground.y} x2={up.x} y2={up.y} stroke={col} strokeOpacity={0.6} />
              <Circle cx={ground.x} cy={ground.y} r={3} fill={col} fillOpacity={0.5} />
              {p.phase === 'enroute' ? <Line x1={up.x} y1={up.y} x2={up.x} y2={up.y - 34} stroke={col} strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" /> : null}
              <Circle cx={up.x} cy={up.y} r={rr + 7} fill={col} fillOpacity={0.12 * pulse * 2} />
              <Circle cx={up.x} cy={up.y} r={rr} fill={col} fillOpacity={0.9} stroke="#0b1020" strokeWidth={2} />
              <Circle cx={up.x - rr * 0.3} cy={up.y - rr * 0.35} r={rr * 0.3} fill="#fff" fillOpacity={0.45} />
            </G>
          );
        })}
        {[...orbs].sort((x, y) => (x.p.id === selected) - (y.p.id === selected)).map(({ p, up }) => {
          const on = selected === p.id;
          if (!on && live.length > 6) return null;
          const col = TRIAGE[p.triage]?.color || color;
          const rr = (on ? 11 : 8.5) * Math.min(1.25, up.k);
          const w = on ? 82 : 42;
          const left = up.x + rr + w + 8 > width;
          const x = left ? up.x - rr - 4 - w : up.x + rr + 4;
          return (
            <G key={`l${p.id}`} onPress={() => onSelect?.(p.id)}>
              <Rect x={x} y={up.y - 10} width={w} height={20} rx={10} fill="#0b1020" fillOpacity={0.94} stroke={col} strokeOpacity={on ? 1 : 0.5} />
              <SvgText x={x + w / 2} y={up.y + 4} fill="#eef1f7" fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>
                {p.phase === 'arrived' ? 'HERE' : `${p.mins} min`}{on ? ` · ${p.id}` : ''}
              </SvgText>
            </G>
          );
        })}
        {!live.length ? (
          <SvgText x={width / 2} y={height - 18} fill="#9ca3af" fontSize={12} textAnchor="middle" fontFamily={SANS}>No patients on the way right now</SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
