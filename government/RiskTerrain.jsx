import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { makeCamera, ring, toPath, useClock } from '../ui3d/project';
import { dragYaw, poly, prism } from './geo3d';
import { world } from './govService';

// "The Risk Field": every area is a beam of light, as tall as its risk score (how many opted-in people depend on
// oxygen, power, dialysis or insulin, weighted up where supplies are far, radio coverage is thin or people have
// gone silent). Rings on the ground show what each radio node covers (red = node down). Red sparks circling a beam
// are people not heard from. Drag to turn, tap a beam. Counts only, no individuals.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

function mix(a, b, k) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

export default function RiskTerrain({ width, height = 330, data, nodes = [], selected, onSelect }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => dragYaw(PanResponder, g, setDrag));
  const yaw = 0.3 + drag + t * 0.05;
  const P = makeCamera({ cx: width / 2, cy: height * 0.64, scale: Math.min(width * 0.19, 78), yaw, pitch: 0.62, dist: 8 });
  if (!data) return <View style={{ width, height }} />;
  const maxRisk = Math.max(1, ...data.areas.map((a) => a.risk));
  const top3 = new Set(data.areas.slice(0, 3).map((a) => a.id));
  const beams = data.areas.map((a) => {
    const [x, z] = world(a.lat, a.lon);
    return { a, x, z, k: a.risk / maxRisk, depth: P(x, 0, z).z };
  }).sort((p, q) => q.depth - p.depth);

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path d={toPath(P, ring(2.8, 0, 90))} fill="#0f1629" stroke="#f472b6" strokeOpacity={0.25} />
        {nodes.filter((n) => n.lat != null).map((n) => {
          const [x, z] = world(n.lat, n.lon);
          const pts = ring(1, 0, 60).map(([rx, , rz]) => [x + rx, 0, z + rz]);   // ~2.5 km reach
          const c0 = P(x, 0, z);
          return (
            <G key={n.id}>
              <Path d={toPath(P, pts)} fill={n.online ? '#38bdf8' : '#f43f5e'} fillOpacity={n.online ? 0.06 : 0.04} stroke={n.online ? '#38bdf8' : '#f43f5e'} strokeOpacity={0.5} strokeDasharray={n.online ? '4 4' : '2 3'} />
              <Circle cx={c0.x} cy={c0.y} r={3.5} fill={n.online ? '#38bdf8' : '#f43f5e'} />
            </G>
          );
        })}
        {beams.map(({ a, x, z, k }) => {
          const on = selected === a.id;
          const col = mix('#a78bfa', '#f43f5e', k);
          const h = 0.08 + k * 1.9;
          const pr = prism(P, x, z, on ? 0.16 : 0.12, h, yaw, 8);
          const top = P(x, h, z);
          const sparks = Math.min(a.silent, 6);
          return (
            <G key={a.id} onPress={() => onSelect?.(a.id)}>
              <Ellipse cx={P(x, 0, z).x} cy={P(x, 0, z).y} rx={18 * k + 6} ry={(18 * k + 6) * 0.35} fill={col} fillOpacity={0.15 + 0.1 * Math.sin(t * 2 + x)} />
              {pr.sides.map((s, i) => <Polygon key={i} points={poly(s.pts)} fill={col} fillOpacity={0.3 + 0.45 * s.shade * (0.4 + k * 0.6)} stroke={col} strokeOpacity={0.6} strokeWidth={0.5} />)}
              <Polygon points={poly(pr.top)} fill={on ? '#ffffff' : col} fillOpacity={0.95} />
              {Array.from({ length: sparks }, (_, i) => {
                const ang = t * 1.6 + (i / sparks) * Math.PI * 2;
                const sp = P(x + Math.cos(ang) * 0.3, h + 0.12, z + Math.sin(ang) * 0.3);
                return <Circle key={i} cx={sp.x} cy={sp.y} r={3} fill="#f43f5e" fillOpacity={0.6 + 0.4 * Math.sin(t * 5 + i)} />;
              })}
              {top3.has(a.id) || on ? (
                <G>
                  <Rect x={top.x - 40} y={top.y - 34} width={80} height={24} rx={9} fill="#0b1020" fillOpacity={0.92} stroke={col} />
                  <SvgText x={top.x} y={top.y - 18} fill="#eef1f7" fontSize={10} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{a.name.split(' ')[0]} · {Math.round(a.risk)}</SvgText>
                </G>
              ) : null}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
