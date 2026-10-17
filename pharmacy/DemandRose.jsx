import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, toPath, useClock } from '../ui3d/project';

// "The Demand Rose": the pharmacy in the middle of a 3D compass. Each of the 8 directions has two glowing columns:
// the inner one for requests within 1.5 km, the outer one for 1.5–5 km. Taller = more people asked from that side
// in the last few hours. Counts only, no people. Drag to turn it.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function column(P, a, r, h, w, yaw) {
  const c = [Math.sin(a) * r, Math.cos(a) * r];           // north = +z, east = +x
  const corners = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([dx, dz]) => [c[0] + dx, c[1] + dz]);
  const top = corners.map(([x, z]) => P(x, h, z));
  const sides = corners.map((p, i) => {
    const q = corners[(i + 1) % 4];
    const nx = q[1] - p[1], nz = p[0] - q[0];                // outward normal of this side
    return { pts: [P(p[0], 0, p[1]), P(q[0], 0, q[1]), P(q[0], h, q[1]), P(p[0], h, p[1])], vis: nx * Math.sin(yaw) + nz * Math.cos(yaw) < 0 };
  }).filter((s) => s.vis);
  return { top, sides, depth: P(c[0], 0, c[1]).z, tip: P(c[0], h, c[1]) };
}

export default function DemandRose({ width, height = 300, sectors = {}, tint = '#a78bfa' }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * 0.01; setDrag(g.live); },
  }));
  const yaw = t * 0.08 + drag;
  const P = makeCamera({ cx: width / 2, cy: height * 0.6, scale: Math.min(width * 0.18, 78), yaw, pitch: 0.55, dist: 7 });
  const max = Math.max(1, ...Object.values(sectors).flatMap((s) => [s.near, s.far]));
  const H = 1.5;
  const cols = DIRS.flatMap((d, i) => {
    const a = (i / 8) * Math.PI * 2;
    const s = sectors[d] || { near: 0, far: 0 };
    return [
      { key: `${d}n`, d, n: s.near, ...column(P, a, 0.9, Math.max(0.03, (s.near / max) * H), 0.13, yaw), near: true },
      { key: `${d}f`, d, n: s.far, ...column(P, a, 1.85, Math.max(0.03, (s.far / max) * H), 0.15, yaw), near: false },
    ];
  }).sort((a, b) => b.depth - a.depth);
  const centre = P(0, 0, 0);
  const pulse = (t * 0.5) % 1;

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path d={toPath(P, ring(2.3, 0, 80))} stroke={tint} strokeOpacity={0.4} fill={tint} fillOpacity={0.05} />
        <Path d={toPath(P, ring(1.35, 0, 80))} stroke={tint} strokeOpacity={0.3} strokeDasharray="3 5" fill="none" />
        <Path d={toPath(P, ring(0.3 + pulse * 2, 0, 60))} stroke={tint} strokeOpacity={(1 - pulse) * 0.5} fill="none" />
        {DIRS.map((d, i) => {
          const a = (i / 8) * Math.PI * 2;
          const l1 = P(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35), l2 = P(Math.sin(a) * 2.3, 0, Math.cos(a) * 2.3);
          return <Path key={d} d={`M${l1.x},${l1.y}L${l2.x},${l2.y}`} stroke={tint} strokeOpacity={0.15} />;
        })}
        {cols.map((c) => {
          const col = c.near ? '#f472b6' : tint;
          const on = c.n > 0;
          return (
            <G key={c.key}>
              {c.sides.map((s, i) => <Polygon key={i} points={poly(s.pts)} fill={col} fillOpacity={on ? 0.45 + i * 0.1 : 0.08} stroke={col} strokeOpacity={on ? 0.9 : 0.2} strokeWidth={0.7} />)}
              <Polygon points={poly(c.top)} fill={col} fillOpacity={on ? 0.95 : 0.15} stroke="#fff" strokeOpacity={on ? 0.5 : 0} strokeWidth={0.6} />
              {on ? <SvgText x={c.tip.x} y={c.tip.y - 6} fill="#eef1f7" fontSize={11} fontWeight="900" textAnchor="middle" fontFamily={SANS}>{c.n}</SvgText> : null}
            </G>
          );
        })}
        {DIRS.map((d, i) => {
          const a = (i / 8) * Math.PI * 2;
          const p = P(Math.sin(a) * 2.75, 0, Math.cos(a) * 2.75);
          return <SvgText key={`l${d}`} x={p.x} y={p.y + 4} fill={d === 'N' ? '#eef1f7' : '#9ca3af'} fontSize={d.length === 1 ? 12 : 9.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{d}</SvgText>;
        })}
        <Circle cx={centre.x} cy={centre.y - 6} r={11} fill="#34d399" stroke="#0b1020" strokeWidth={2} />
        <Path d={`M${centre.x - 5},${centre.y - 6}H${centre.x + 5}M${centre.x},${centre.y - 11}V${centre.y - 1}`} stroke="#04241a" strokeWidth={2.4} />
      </Svg>
    </View>
  );
}
