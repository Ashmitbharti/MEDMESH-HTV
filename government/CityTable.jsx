import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { makeCamera, useClock } from '../ui3d/project';
import { dragYaw, poly, prism } from './geo3d';
import { TRIAGE, world } from './govService';

// "The City Table": Scarborough as a 3D planning table. Each neighbourhood is a hexagonal block, as tall as its
// active cases and coloured by the most serious one; hospitals are towers with a ring that fills with free beds
// (grey when closed); radio nodes are pins that pulse when up and turn into a red cross when down.
// Drag to turn the table, tap a block for that area. De-identified: counts only.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

export default function CityTable({ width, height = 340, data, selected, onSelect }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => dragYaw(PanResponder, g, setDrag));
  const yaw = -0.25 + drag + Math.sin(t * 0.2) * 0.1;
  const P = makeCamera({ cx: width / 2, cy: height * 0.58, scale: Math.min(width * 0.2, 82), yaw, pitch: 0.75, dist: 8 });
  if (!data) return <View style={{ width, height }} />;

  const maxCases = Math.max(1, ...data.areas.map((a) => a.active + Object.values(a.cases).reduce((x, y) => x + y, 0) * 0.3));
  const plate = [[-2.7, -2.4], [2.7, -2.4], [2.7, 2.4], [-2.7, 2.4]].map(([x, z]) => P(x, 0, z));
  const items = [];
  for (const a of data.areas) {
    const [x, z] = world(a.lat, a.lon);
    const total = Object.values(a.cases).reduce((p, q) => p + q, 0);
    const worst = ['1', '2', '3', '4'].find((k) => a.cases[k] > 0);
    const h = 0.06 + ((a.active + total * 0.3) / maxCases) * 1.3;
    items.push({ kind: 'area', a, x, z, h, total, worst, depth: P(x, 0, z).z });
  }
  for (const hsp of data.hospitals) {
    const [x, z] = world(hsp.lat, hsp.lon);
    items.push({ kind: 'hosp', h: hsp, x, z, depth: P(x, 0, z).z - 0.01 });
  }
  for (const n of data.nodes.filter((nd) => nd.lat != null)) {
    const [x, z] = world(n.lat, n.lon);
    items.push({ kind: 'node', n, x, z, depth: P(x, 0, z).z - 0.02 });
  }
  items.sort((p, q) => q.depth - p.depth);

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        {[[10, 10, 1, 1], [width - 10, 10, -1, 1], [10, height - 10, 1, -1], [width - 10, height - 10, -1, -1]].map(([x, y, sx, sy], i) => (
          <Path key={i} d={`M${x},${y + sy * 18}L${x},${y}L${x + sx * 18},${y}`} stroke="#a78bfa" strokeOpacity={0.5} strokeWidth={1.5} fill="none" />
        ))}
        <Polygon points={poly(plate)} fill="#0f1629" stroke="#a78bfa" strokeOpacity={0.35} />
        {Array.from({ length: 9 }, (_, i) => {
          const v = -2.4 + i * 0.6;
          const a = P(-2.7, 0, v), b = P(2.7, 0, v);
          return <Line key={`g${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a78bfa" strokeOpacity={0.07} />;
        })}
        {(() => { const n = P(0, 0, 2.6); return <SvgText x={n.x} y={n.y} fill="#9ca3af" fontSize={11} fontWeight="800" textAnchor="middle" fontFamily={SANS}>N</SvgText>; })()}
        {items.map((it) => {
          if (it.kind === 'area') {
            const { a } = it;
            const on = selected === a.id;
            const col = it.worst ? TRIAGE[it.worst].color : '#7dd3fc';
            const lift = on ? 0.05 + Math.sin(t * 3) * 0.02 : 0;
            const pr = prism(P, it.x, it.z, 0.3, it.h, yaw, 6, lift);
            const tip = P(it.x, it.h + lift + 0.12, it.z);
            return (
              <G key={a.id} onPress={() => onSelect?.(a.id)}>
                <Polygon points={poly(pr.base)} fill={col} fillOpacity={0.08} stroke={col} strokeOpacity={0.3} />
                {pr.sides.map((s, i) => <Polygon key={i} points={poly(s.pts)} fill={col} fillOpacity={(it.total ? 0.55 : 0.12) * s.shade} stroke={col} strokeOpacity={on ? 1 : 0.6} strokeWidth={0.7} />)}
                <Polygon points={poly(pr.top)} fill={col} fillOpacity={it.total ? 0.9 : 0.2} stroke={on ? '#fff' : col} strokeOpacity={on ? 1 : 0.6} strokeWidth={on ? 1.6 : 0.8} />
                {it.total || on ? (
                  <G>
                    <Rect x={tip.x - 30} y={tip.y - 26} width={60} height={22} rx={8} fill="#0b1020" fillOpacity={0.92} stroke={col} strokeOpacity={0.7} />
                    <SvgText x={tip.x} y={tip.y - 11} fill="#eef1f7" fontSize={10} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{a.name.split(' ')[0]} {it.total}</SvgText>
                  </G>
                ) : null}
              </G>
            );
          }
          if (it.kind === 'hosp') {
            const { h } = it;
            const base = P(it.x, 0, it.z), top = P(it.x, 0.95, it.z);
            const frac = h.total ? h.free / h.total : 0;
            const r = 12 * base.k;
            const col = h.open ? '#fca5a5' : '#64748b';
            return (
              <G key={`h${h.id}`}>
                <Line x1={base.x} y1={base.y} x2={top.x} y2={top.y} stroke={col} strokeWidth={5} strokeLinecap="round" strokeOpacity={0.85} />
                <Circle cx={top.x} cy={top.y} r={r} fill="#0b1020" stroke={col} strokeOpacity={0.4} strokeWidth={3} />
                <Path d={`M${top.x},${top.y - r}A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${top.x + r * Math.sin(frac * 2 * Math.PI * 0.999)},${top.y - r * Math.cos(frac * 2 * Math.PI * 0.999)}`}
                  stroke={h.open ? '#34d399' : '#64748b'} strokeWidth={3} fill="none" />
                <SvgText x={top.x} y={top.y + 3.5} fill="#eef1f7" fontSize={8.5} fontWeight="900" textAnchor="middle" fontFamily={SANS}>{h.id}</SvgText>
              </G>
            );
          }
          const { n } = it;
          const b = P(it.x, 0, it.z), tp = P(it.x, 0.45, it.z);
          const pulse = (t * 0.8 + it.x) % 1;
          return (
            <G key={`n${n.id}`}>
              <Line x1={b.x} y1={b.y} x2={tp.x} y2={tp.y} stroke={n.online ? '#7dd3fc' : '#f43f5e'} strokeWidth={1.5} />
              {n.online ? <Circle cx={tp.x} cy={tp.y} r={4 + pulse * 12} fill="none" stroke="#7dd3fc" strokeOpacity={1 - pulse} /> : null}
              {n.online ? <Circle cx={tp.x} cy={tp.y} r={4} fill="#7dd3fc" />
                : <Path d={`M${tp.x - 5},${tp.y - 5}L${tp.x + 5},${tp.y + 5}M${tp.x + 5},${tp.y - 5}L${tp.x - 5},${tp.y + 5}`} stroke="#f43f5e" strokeWidth={2.5} />}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
