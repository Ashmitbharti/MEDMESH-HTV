import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, splitPath, toPath, useClock } from '../ui3d/project';
import { c } from '../medmesh-id/theme';

// 3D radar of a MedMesh network: the command centre in the middle, LoRa nodes as light pillars, radio links
// arcing between them with packets hopping across, and a radar sweep that lights each node as it passes.
// Drag to rotate.

const NODES = [
  { id: 'BASE', a: 0, r: 0, h: 1.25, color: c.sky, label: 'Command centre', base: true },
  { id: 'FIELD', a: 0.5, r: 1.55, h: 0.75, color: c.sky, label: 'Field' },
  { id: 'RELAY', a: 2.2, r: 1.35, h: 0.9, color: c.sky, label: 'Relay' },
  { id: 'RESP', a: 3.6, r: 1.7, h: 0.7, color: c.sky, label: 'Ambulance' },
  { id: 'HOSP', a: 4.9, r: 2.05, h: 0.85, color: c.redl, label: 'Hospital', glyph: '+' },
  { id: 'PHARM', a: 1.35, r: 2.2, h: 0.65, color: c.amber, label: 'Pharmacy', glyph: 'Rx' },
  { id: 'HOME', a: 5.75, r: 1.1, h: 0.5, color: c.green, label: 'You' },
];
const LINKS = [['FIELD', 'BASE'], ['RELAY', 'BASE'], ['RESP', 'RELAY'], ['HOSP', 'BASE'], ['PHARM', 'FIELD'], ['HOME', 'BASE'], ['HOME', 'HOSP']];
const pos = (n) => [Math.cos(n.a) * n.r, 0, Math.sin(n.a) * n.r];

function arcPts(a, b, lift, n = 24) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + Math.sin(Math.PI * k) * lift, a[2] + (b[2] - a[2]) * k];
  });
}

export default function MeshRadar({ width, height = 320 }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [gesture] = useState(() => ({ start: 0, live: 0 })); // mutable gesture scratch, not render state
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
    onPanResponderGrant: () => { gesture.start = gesture.live; },
    onPanResponderMove: (_, g) => { gesture.live = gesture.start + g.dx * 0.012; setDrag(gesture.live); },
  }));

  const yaw = t * 0.12 + drag;
  const P = makeCamera({ cx: width / 2, cy: height * 0.6, scale: Math.min(width, 420) * 0.19, yaw, pitch: 0.62, dist: 7 });
  const sweep = (t * 1.3) % (Math.PI * 2);

  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const tops = Object.fromEntries(NODES.map((n) => { const p = pos(n); return [n.id, [p[0], n.h, p[2]]]; }));

  // radar sweep trail: wedges behind the sweep line, fading out
  const wedges = [0, 1, 2, 3, 4, 5].map((i) => {
    const a1 = sweep - i * 0.12;
    const a0 = a1 - 0.12;
    const pts = [[0, 0, 0], ...Array.from({ length: 7 }, (_, j) => {
      const a = a0 + ((a1 - a0) * j) / 6;
      return [Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5];
    }), [0, 0, 0]];
    return { d: `${toPath(P, pts)}Z`, o: 0.22 * (1 - i / 6) };
  });
  const sweepEnd = P(Math.cos(sweep) * 2.5, 0, Math.sin(sweep) * 2.5);
  const centre = P(0, 0, 0);

  const rings = [0.85, 1.7, 2.5].map((r) => splitPath(P, ring(r)));
  const spokes = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3;
    const p0 = P(0, 0, 0);
    const p1 = P(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
    return `M${p0.x},${p0.y}L${p1.x},${p1.y}`;
  }).join('');

  // draw far things first
  const order = [...NODES].sort((a, b) => P(...pos(b)).z - P(...pos(a)).z);

  return (
    <View style={{ width, height }} {...pan.panHandlers} accessible accessibilityLabel="3D view of a MedMesh network. Drag to rotate.">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="floor" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#38bdf8" stopOpacity="0.20" />
            <Stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
            <Stop offset="0.35" stopColor="#7dd3fc" stopOpacity="0.5" />
            <Stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Path d={`${toPath(P, ring(2.6))}Z`} fill="url(#floor)" />
        {rings.map((r, i) => (
          <G key={i}>
            <Path d={r.far} stroke={c.sky} strokeOpacity={0.14} strokeWidth={1} fill="none" />
            <Path d={r.near} stroke={c.sky} strokeOpacity={0.32} strokeWidth={1} fill="none" />
          </G>
        ))}
        <Path d={spokes} stroke={c.sky} strokeOpacity={0.08} strokeWidth={1} />
        {wedges.map((w, i) => <Path key={i} d={w.d} fill="#38bdf8" fillOpacity={w.o} />)}
        <Line x1={centre.x} y1={centre.y} x2={sweepEnd.x} y2={sweepEnd.y} stroke="#bae6fd" strokeOpacity={0.8} strokeWidth={1.5} />

        {LINKS.map(([a, b], i) => {
          const pts = arcPts(tops[a], tops[b], 0.55);
          const k = ((t * 0.45 + i * 0.29) % 1);
          const idx = Math.round(k * (pts.length - 1));
          const pk = P(...pts[idx]);
          return (
            <G key={a + b}>
              <Path d={toPath(P, pts)} stroke={byId[a].color === c.sky ? c.sky : byId[a].color} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="3 4" fill="none" />
              <Circle cx={pk.x} cy={pk.y} r={2.6 * pk.k} fill="#e0f2fe" />
            </G>
          );
        })}

        {order.map((n) => {
          const g = P(...pos(n));
          const top = P(...tops[n.id]);
          const ang = Math.atan2(Math.sin(n.a), Math.cos(n.a));
          let diff = ((sweep - ((ang + Math.PI * 2) % (Math.PI * 2))) + Math.PI * 4) % (Math.PI * 2);
          if (n.base) diff = 0.2;
          const lit = Math.max(0, 1 - diff / 1.2);
          const pulse = n.base ? 0.5 + 0.5 * Math.sin(t * 3) : lit;
          return (
            <G key={n.id}>
              <Path d={`${toPath(P, ring(0.16 + pulse * 0.12).map(([x, , z]) => [x + pos(n)[0], 0, z + pos(n)[2]]))}Z`}
                stroke={n.color} strokeOpacity={0.25 + pulse * 0.5} fill={n.color} fillOpacity={0.05 + pulse * 0.1} />
              <Line x1={g.x} y1={g.y} x2={top.x} y2={top.y} stroke={n.color} strokeOpacity={0.55 + pulse * 0.4} strokeWidth={n.base ? 3 : 2} />
              <Circle cx={top.x} cy={top.y} r={(n.base ? 16 : 11) * top.k * (1 + pulse * 0.4)} fill="url(#glow)" opacity={0.5 + pulse * 0.5} />
              <Circle cx={top.x} cy={top.y} r={(n.base ? 5 : 3.6) * top.k} fill={n.color} />
              {n.glyph ? (
                <SvgText x={top.x} y={top.y - 12 * top.k} fill={n.color} fontSize={11 * top.k} fontWeight="800" textAnchor="middle" fontFamily="Inter, -apple-system, Segoe UI, Roboto, sans-serif">{n.glyph}</SvgText>
              ) : null}
              <SvgText x={top.x} y={top.y - (n.glyph ? 25 : 12) * top.k} fill="#e0f2fe" fillOpacity={0.55 + pulse * 0.45}
                fontSize={9.5 * top.k} fontWeight="700" textAnchor="middle" letterSpacing="0.8" fontFamily="Inter, -apple-system, Segoe UI, Roboto, sans-serif">{n.label.toUpperCase()}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
