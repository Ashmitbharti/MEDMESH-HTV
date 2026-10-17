import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { makeCamera, useClock } from '../ui3d/project';
import { dragYaw, poly } from './geo3d';
import { TRIAGE } from './govService';

// "The Time Ribbon": the disaster as a 3D strip of time. Each slice is one time bin; its stacked blocks are the new
// cases in that bin by triage (red at the bottom). A light runs along the ribbon so you can read it left to right.
// Drag to turn. Exact numbers are in the tiles and table below.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';

function box(P, x, y0, y1, w, d, yaw) {
  const v = (dx, y, dz) => P(x + dx * w, y, dz * d);
  const sides = [
    { n: [0, -1], pts: [v(-1, y0, -1), v(1, y0, -1), v(1, y1, -1), v(-1, y1, -1)], s: 0.8 },
    { n: [0, 1], pts: [v(-1, y0, 1), v(1, y0, 1), v(1, y1, 1), v(-1, y1, 1)], s: 0.6 },
    { n: [-1, 0], pts: [v(-1, y0, -1), v(-1, y0, 1), v(-1, y1, 1), v(-1, y1, -1)], s: 0.5 },
    { n: [1, 0], pts: [v(1, y0, -1), v(1, y0, 1), v(1, y1, 1), v(1, y1, -1)], s: 0.7 },
  ].filter((f) => f.n[0] * Math.sin(yaw) + f.n[1] * Math.cos(yaw) < 0);
  return { sides, top: [v(-1, y1, -1), v(1, y1, -1), v(1, y1, 1), v(-1, y1, 1)] };
}

export default function TimeRibbon({ width, height = 260, timeline = [], binMin = 10 }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => dragYaw(PanResponder, g, setDrag, 0.008));
  const yaw = -0.45 + drag;
  const P = makeCamera({ cx: width / 2, cy: height * 0.72, scale: Math.min(width * 0.2, 84), yaw, pitch: 0.42, dist: 8 });
  const n = Math.max(1, timeline.length);
  const span = 4.2;
  const step = span / Math.max(n, 6);
  const max = Math.max(1, ...timeline.map((b) => ['1', '2', '3', '4'].reduce((a, k) => a + (b[k] || 0), 0)));
  const H = 1.7;
  const x0 = -((n - 1) * step) / 2;
  const sweep = x0 + ((t * 0.5) % 1) * (n - 1 || 1) * step;
  const order = timeline.map((b, i) => ({ b, i, x: x0 + i * step, depth: P(x0 + i * step, 0, 0).z })).sort((p, q) => q.depth - p.depth);
  const floor = [[x0 - step, -0.5], [x0 + n * step, -0.5], [x0 + n * step, 0.5], [x0 - step, 0.5]].map(([x, z]) => P(x, 0, z));

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Polygon points={poly(floor)} fill="#0f1629" stroke="#7dd3fc" strokeOpacity={0.25} />
        {(() => { const a = P(sweep, 0, -0.5), b = P(sweep, 0, 0.5); return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7dd3fc" strokeWidth={2} strokeOpacity={0.6} />; })()}
        {order.map(({ b, i, x }) => {
          let y = 0;
          const parts = ['1', '2', '3', '4'].filter((k) => b[k]).map((k) => {
            const h = (b[k] / max) * H;
            const part = { k, y0: y, y1: y + h };
            y += h;
            return part;
          });
          const lab = P(x, y + 0.12, 0);
          const foot = P(x, 0, 0.62);
          return (
            <G key={i}>
              {parts.map((p) => {
                const bx = box(P, x, p.y0, p.y1, Math.min(0.28, step * 0.38), 0.32, yaw);
                const col = TRIAGE[p.k].color;
                return (
                  <G key={p.k}>
                    {bx.sides.map((s, j) => <Polygon key={j} points={poly(s.pts)} fill={col} fillOpacity={0.35 + 0.5 * s.s} stroke="#05070f" strokeWidth={0.8} />)}
                    <Polygon points={poly(bx.top)} fill={col} fillOpacity={0.95} stroke="#05070f" strokeWidth={0.8} />
                  </G>
                );
              })}
              {y > 0 ? <SvgText x={lab.x} y={lab.y - 4} fill="#eef1f7" fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{['1', '2', '3', '4'].reduce((a, k) => a + (b[k] || 0), 0)}</SvgText> : null}
              {n <= 12 || i % Math.ceil(n / 8) === 0 ? <SvgText x={foot.x} y={foot.y + 12} fill="#6b7280" fontSize={9} textAnchor="middle" fontFamily={SANS}>{b.bin * binMin}m</SvgText> : null}
            </G>
          );
        })}
        {!timeline.length ? <SvgText x={width / 2} y={height / 2} fill="#9ca3af" fontSize={12.5} textAnchor="middle" fontFamily={SANS}>No cases yet</SvgText> : null}
      </Svg>
    </View>
  );
}
