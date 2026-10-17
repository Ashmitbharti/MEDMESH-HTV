import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient as SvgGrad, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, toPath, useClock } from '../ui3d/project';
import { STATUS } from './hospitalService';

// "The Bed Tower": the hospital as a see-through 3D building, one glass floor per kind of space.
//   ICU floor   (top)    every ICU bed is a cube; free beds glow violet, occupied ones are solid
//   Ward floor           every inpatient bed; free beds glow green
//   ER floor  (bottom)   treatment bays, with a clock ring showing the current ER wait
// The aura on the ground is the status the command centre sees (accepting / diverting / closed).
// A scan plane sweeps up after every change. Drag to turn it; tap a floor to edit that floor.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const W = 3.2;
const D = 1.9;
const GAP = 1.05;

export const FLOORS = [
  { key: 'er', label: 'ER', tint: '#fb923c' },
  { key: 'ward', label: 'Beds', tint: '#34d399' },
  { key: 'icu', label: 'ICU', tint: '#a78bfa' },
];

const mix = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;
const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function cubeFaces(P, x, y, z, s, yaw) {
  const v = (dx, dy, dz) => P(x + dx * s, y + dy * s * 2, z + dz * s);
  const top = [v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1)];
  const sides = [
    { n: [0, -1], pts: [v(-1, 0, -1), v(1, 0, -1), v(1, 1, -1), v(-1, 1, -1)], shade: 0.75 },
    { n: [0, 1], pts: [v(-1, 0, 1), v(1, 0, 1), v(1, 1, 1), v(-1, 1, 1)], shade: 0.6 },
    { n: [-1, 0], pts: [v(-1, 0, -1), v(-1, 0, 1), v(-1, 1, 1), v(-1, 1, -1)], shade: 0.5 },
    { n: [1, 0], pts: [v(1, 0, -1), v(1, 0, 1), v(1, 1, 1), v(1, 1, -1)], shade: 0.65 },
  ].filter((f) => f.n[0] * Math.sin(yaw) + f.n[1] * Math.cos(yaw) < 0);   // faces turned towards the camera
  return { top, sides };
}

function layout(n, cols) {
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = (W - 0.3) / cols;
  const rd = Math.min(cw, (D - 0.3) / rows);
  return Array.from({ length: n }, (_, i) => ({
    x: -W / 2 + 0.15 + cw * ((i % cols) + 0.5),
    z: -((rows - 1) * rd) / 2 + rd * Math.floor(i / cols),
    s: Math.min(cw, rd) * 0.3,
  }));
}

export default function HospitalTower({ width, height = 350, fig, focus, onFloor, pulseAt = 0 }) {
  const { t, now } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [touched, setTouched] = useState(false);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; setTouched(true); },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * 0.01; setDrag(g.live); },
  }));

  const yaw = 0.55 + drag + (touched ? 0 : Math.sin(t * 0.35) * 0.32);
  const P = makeCamera({ cx: width * 0.4, cy: height * 0.7, scale: Math.min(width * 0.155, 62), yaw, pitch: 0.5, dist: 7 });
  const st = STATUS[fig.status] || STATUS.open;
  const sweep = Math.max(0, 1 - (now - pulseAt) / 1800);                  // scan plane after an update
  const scanY = sweep > 0 ? (1 - sweep) * GAP * 3 : ((t * 0.45) % 4) * GAP - GAP * 0.5;

  const floors = [
    { ...FLOORS[0], y: 0, n: Math.min(fig.erSpaces || 0, 24), free: -1, cols: 8, value: `${fig.wait} min wait` },
    { ...FLOORS[1], y: GAP, n: Math.min(fig.total, 40), free: Math.min(fig.free, 40), cols: 10, value: `${fig.free}/${fig.total} free` },
    { ...FLOORS[2], y: GAP * 2, n: Math.min(fig.icuTotal, 16), free: Math.min(fig.icu, 16), cols: 8, value: fig.icuTotal ? `${fig.icu}/${fig.icuTotal} free` : 'none' },
  ];

  const aura = ring(2.05 + Math.sin(t * 2) * 0.05, -0.02, 72);
  const aura2 = ring(2.4, -0.02, 72);
  const corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  const callX = width * 0.8;

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGrad id="scan" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#7dd3fc" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#7dd3fc" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
          </SvgGrad>
        </Defs>

        {/* AR frame */}
        {[[10, 10, 1, 1], [width - 10, 10, -1, 1], [10, height - 10, 1, -1], [width - 10, height - 10, -1, -1]].map(([x, y, sx, sy], i) => (
          <Path key={i} d={`M${x},${y + sy * 18}L${x},${y}L${x + sx * 18},${y}`} stroke="#7dd3fc" strokeOpacity={0.5} strokeWidth={1.5} fill="none" />
        ))}

        {/* status aura on the ground */}
        <Path d={toPath(P, aura)} stroke={st.tint} strokeOpacity={0.75} strokeWidth={2} fill={mix(st.tint, 0.06)} />
        <Path d={toPath(P, aura2)} stroke={st.tint} strokeOpacity={0.25} strokeWidth={1} strokeDasharray="3 6" fill="none" />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2 + t * 0.2;
          const p1 = P(Math.cos(a) * 2.18, -0.02, Math.sin(a) * 2.18);
          const p2 = P(Math.cos(a) * 2.3, -0.02, Math.sin(a) * 2.3);
          return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={st.tint} strokeOpacity={0.5} strokeWidth={1.4} />;
        })}

        {/* pillars */}
        {corners.map(([x, z], i) => {
          const a = P(x, 0, z), b = P(x, GAP * 2 + 0.6, z);
          return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7dd3fc" strokeOpacity={0.22} strokeWidth={1} />;
        })}

        {floors.map((f) => {
          const on = focus === f.key;
          const slab = corners.map(([x, z]) => P(x, f.y, z));
          const cells = layout(f.n, f.cols).map((p, i) => ({ ...p, i, depth: P(p.x, f.y, p.z).z }))
            .sort((a, b) => b.depth - a.depth);
          const edge = P(W / 2, f.y + 0.2, 0);
          return (
            <G key={f.key} onPress={() => onFloor?.(f.key)}>
              <Polygon points={poly(slab)} fill={mix(f.tint, on ? 0.2 : 0.08)} stroke={f.tint} strokeOpacity={on ? 0.95 : 0.45} strokeWidth={on ? 2 : 1.2} />
              {cells.map((p) => {
                const isFree = f.free < 0 ? null : p.i < f.free;
                const { top, sides } = cubeFaces(P, p.x, f.y + 0.01, p.z, p.s, yaw);
                const glow = isFree === null ? 0.35 : isFree ? 0.55 + Math.sin(t * 3 + p.i) * 0.15 : 0;
                const body = isFree === null ? '#fb923c' : isFree ? f.tint : '#334155';
                return (
                  <G key={p.i}>
                    {sides.map((s, k) => <Polygon key={k} points={poly(s.pts)} fill={isFree ? mix(body, glow * s.shade) : mix(body, 0.9 * s.shade)} stroke={isFree ? body : '#475569'} strokeOpacity={isFree ? 0.9 : 0.5} strokeWidth={0.6} />)}
                    <Polygon points={poly(top)} fill={isFree ? mix(body, glow) : mix(isFree === null ? body : '#475569', 0.85)} stroke={isFree ? '#ffffff' : '#64748b'} strokeOpacity={isFree ? 0.6 : 0.4} strokeWidth={0.6} />
                  </G>
                );
              })}
              {f.key === 'er' ? (() => {
                const frac = Math.min(1, (fig.wait || 0) / 180);
                const arc = Array.from({ length: 41 }, (_, i) => {
                  const a = -Math.PI / 2 + (i / 40) * frac * Math.PI * 2;
                  return [Math.cos(a) * 1.25, f.y + 0.02, Math.sin(a) * 1.25 * (D / W) * 1.4];
                });
                return <Path d={toPath(P, arc)} stroke="#fdba74" strokeWidth={2.4} strokeLinecap="round" fill="none" strokeOpacity={0.85} />;
              })() : null}
              {/* callout */}
              <Line x1={edge.x} y1={edge.y} x2={callX - 6} y2={edge.y} stroke={f.tint} strokeOpacity={0.6} strokeDasharray="2 3" />
              <Rect x={callX - 6} y={edge.y - 19} width={width - callX - 4} height={38} rx={10} fill="#0b1020" fillOpacity={0.9} stroke={f.tint} strokeOpacity={on ? 1 : 0.5} />
              <SvgText x={callX + 3} y={edge.y - 4} fill={f.tint} fontSize={10} fontWeight="800" fontFamily={SANS} letterSpacing={1.2}>{f.label.toUpperCase()}</SvgText>
              <SvgText x={callX + 3} y={edge.y + 11} fill="#eef1f7" fontSize={11.5} fontWeight="700" fontFamily={SANS}>{f.value}</SvgText>
            </G>
          );
        })}

        {/* roof + scan plane */}
        <Polygon points={poly(corners.map(([x, z]) => P(x, GAP * 2 + 0.6, z)))} fill="none" stroke="#7dd3fc" strokeOpacity={0.3} strokeDasharray="4 4" />
        {scanY > -0.2 && scanY < GAP * 2 + 0.6 ? (
          <Polygon points={poly(corners.map(([x, z]) => P(x * 1.08, scanY, z * 1.08)))} fill="url(#scan)" stroke="#7dd3fc" strokeOpacity={0.6 * (sweep > 0 ? 1 : 0.5)} strokeWidth={1} />
        ) : null}
        {(() => { const h = P(0, GAP * 2 + 0.95, 0); return (
          <G>
            <Line x1={h.x} y1={h.y + 6} x2={h.x} y2={P(0, GAP * 2 + 0.6, 0).y} stroke={st.tint} strokeOpacity={0.6} />
            <Rect x={h.x - 34} y={h.y - 14} width={68} height={20} rx={10} fill={mix(st.tint, 0.2)} stroke={st.tint} />
            <SvgText x={h.x} y={h.y} fill="#eef1f7" fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{st.label.toUpperCase()}</SvgText>
          </G>
        ); })()}
      </Svg>
    </View>
  );
}
