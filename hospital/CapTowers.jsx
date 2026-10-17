import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { makeCamera, useClock } from '../ui3d/project';
import { PLACES } from './hospitalService';

// "Price towers under a glass ceiling": one tower per seller, as tall as their emergency price for this item.
// The glass plane is the fair-price cap (normal price + 10%); the dashed line on the plinth is the normal price.
// Anything that pokes through the glass turns red: the command centre skips that seller and logs it.
// Drag to turn. Exact numbers are on every tower and in the board below.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const OK = '#34d399';
const BAD = '#f43f5e';
const H = 2.1;
const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function prism(P, x, z, s, y0, y1, yaw) {
  const v = (dx, y, dz) => P(x + dx * s, y, z + dz * s);
  const top = [v(-1, y1, -1), v(1, y1, -1), v(1, y1, 1), v(-1, y1, 1)];
  const sides = [
    { n: [0, -1], pts: [v(-1, y0, -1), v(1, y0, -1), v(1, y1, -1), v(-1, y1, -1)], shade: 0.8 },
    { n: [0, 1], pts: [v(-1, y0, 1), v(1, y0, 1), v(1, y1, 1), v(-1, y1, 1)], shade: 0.6 },
    { n: [-1, 0], pts: [v(-1, y0, -1), v(-1, y0, 1), v(-1, y1, 1), v(-1, y1, -1)], shade: 0.5 },
    { n: [1, 0], pts: [v(1, y0, -1), v(1, y0, 1), v(1, y1, 1), v(1, y1, -1)], shade: 0.7 },
  ].filter((f) => f.n[0] * Math.sin(yaw) + f.n[1] * Math.cos(yaw) < 0);
  return { top, sides };
}

export default function CapTowers({ width, height = 270, data, changedAt = 0 }) {
  const { t, now } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * 0.01; setDrag(g.live); },
  }));
  if (!data) return <View style={{ width, height }} />;

  const offers = data.offers || [];
  const top = Math.max(data.cap || 0, ...offers.map((o) => o.price)) * 1.08 || 1;
  const grow = Math.min(1, (now - changedAt) / 700);                  // towers rise when the item changes
  const ease = 1 - (1 - grow) ** 3;
  const yOf = (price) => (price / top) * H * ease;
  const capY = (data.cap / top) * H;
  const baseY = (data.base / top) * H;
  const yaw = -0.5 + drag + Math.sin(t * 0.3) * 0.12;
  const P = makeCamera({ cx: width / 2, cy: height * 0.82, scale: Math.min(width * 0.17, 72), yaw, pitch: 0.36, dist: 7 });
  const n = Math.max(1, offers.length);
  const span = Math.min(3.2, n * 1.0);
  const xs = offers.map((_, i) => (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));
  const plW = span / 2 + 0.7;
  const plinth = [[-plW, -0.6], [plW, -0.6], [plW, 0.6], [-plW, 0.6]];
  const towers = offers.map((o, i) => ({ o, x: xs[i], depth: P(xs[i], 0, 0).z })).sort((a, b) => b.depth - a.depth);
  const glass = plinth.map(([x, z]) => P(x, capY, z));
  const capLab = P(plW, capY, -0.6);

  const tower = ({ o, x }) => {
    const y1 = yOf(o.price);
    const tint = !o.open ? '#64748b' : o.within ? OK : BAD;
    const parts = !o.within && y1 > capY ? [[0, capY, '#38bdf8'], [capY, y1, BAD]] : [[0, y1, o.open ? '#38bdf8' : '#64748b']];
    const lab = P(x, y1 + 0.18, 0);
    return (
      <G key={o.pharm}>
        {parts.map(([a, b, col], k) => {
          const { top: tp, sides } = prism(P, x, 0, 0.26, a, b, yaw);
          const over = col === BAD;
          return (
            <G key={k}>
              {sides.map((s, j) => <Polygon key={j} points={poly(s.pts)} fill={col} fillOpacity={(over ? 0.55 + Math.sin(t * 4) * 0.15 : 0.35) * s.shade + 0.15} stroke={col} strokeOpacity={0.9} strokeWidth={0.8} />)}
              {k === parts.length - 1 ? <Polygon points={poly(tp)} fill={col} fillOpacity={0.85} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.6} /> : null}
            </G>
          );
        })}
        <Rect x={lab.x - 44} y={lab.y - 30} width={88} height={30} rx={9} fill="#0b1020" fillOpacity={0.92} stroke={tint} strokeOpacity={0.8} />
        <SvgText x={lab.x} y={lab.y - 17} fill="#eef1f7" fontSize={11} fontWeight="800" textAnchor="middle" fontFamily={SANS}>${o.price.toFixed(2)}</SvgText>
        <SvgText x={lab.x} y={lab.y - 5} fill="#9ca3af" fontSize={9} fontWeight="700" textAnchor="middle" fontFamily={SANS}>{(PLACES[o.pharm] || o.name).slice(0, 14)}{o.open ? '' : ' · shut'}</SvgText>
      </G>
    );
  };

  // the glass is drawn over the towers, so the part of a tower above the cap reads as poking through it
  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Polygon points={poly(plinth.map(([x, z]) => P(x, 0, z)))} fill="#0f1629" stroke="#7dd3fc" strokeOpacity={0.3} />
        {towers.map(tower)}
        <Polygon points={poly(glass)} fill={OK} fillOpacity={0.1 + Math.sin(t * 1.5) * 0.03} stroke={OK} strokeOpacity={0.85} strokeWidth={1.4} />
        {(() => { const a = P(-plW, baseY, 0.6), b = P(plW, baseY, 0.6); return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e2e8f0" strokeOpacity={0.55} strokeDasharray="4 4" />; })()}
        {towers.filter(({ o }) => !o.within && yOf(o.price) > capY).map(({ o, x }) => {
          const p = P(x, capY, 0);
          const r = 10 + ((t * 18) % 14);
          return <Path key={`h${o.pharm}`} d={`M${p.x - r},${p.y}A${r},${r * 0.35} 0 1 0 ${p.x + r},${p.y}A${r},${r * 0.35} 0 1 0 ${p.x - r},${p.y}`} stroke={BAD} strokeOpacity={Math.max(0, 1 - (r - 10) / 14)} fill="none" />;
        })}
        <Rect x={Math.min(width - 104, capLab.x + 6)} y={capLab.y - 12} width={98} height={22} rx={11} fill="#052e1f" stroke={OK} />
        <SvgText x={Math.min(width - 104, capLab.x + 6) + 49} y={capLab.y + 3} fill="#bbf7d0" fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>CAP ${data.cap?.toFixed(2)}</SvgText>
      </Svg>
    </View>
  );
}
