import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Ellipse, G, Polygon, Text as SvgText } from 'react-native-svg';
import { makeCamera, useClock } from '../ui3d/project';

// "The Beacon": a solid 3D pharmacy cross turning above the counter. Every request waiting for an answer sends a
// ripple across the floor; the cross glows red when someone is out of their medicine right now. Drag to spin it.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const A = 0.22;   // half arm width
const L = 0.62;   // half arm length
const PLUS = [[-A, L], [A, L], [A, A], [L, A], [L, -A], [A, -A], [A, -L], [-A, -L], [-A, -A], [-L, -A], [-L, A], [-A, A]];

export default function Beacon({ width, height = 190, waiting = 0, urgent = false, held = 0 }) {
  const { t } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * 0.012; setDrag(g.live); },
  }));
  const yaw = t * 0.7 + drag;
  const cx = width * 0.3;
  const P = makeCamera({ cx, cy: height * 0.86, scale: Math.min(width * 0.15, 60), yaw, pitch: 0.22, dist: 6 });
  const tint = urgent ? '#f43f5e' : waiting ? '#34d399' : '#7dd3fc';
  const y0 = 1.05 + Math.sin(t * 1.6) * 0.06;
  const D = 0.17;
  const v = (x, y, z) => P(x, y + y0, z);
  const front = PLUS.map(([x, y]) => v(x, y, D));
  const back = PLUS.map(([x, y]) => v(x, y, -D));
  const faces = [
    { pts: back, shade: 0.5, depth: back.reduce((s, p) => s + p.z, 0) / back.length },
    { pts: front, shade: 1, depth: front.reduce((s, p) => s + p.z, 0) / front.length },
    ...PLUS.map((_, i) => {
      const j = (i + 1) % PLUS.length;
      const pts = [front[i], front[j], back[j], back[i]];
      return { pts, shade: 0.7, depth: pts.reduce((s, p) => s + p.z, 0) / 4 };
    }),
  ].sort((a, b) => b.depth - a.depth);
  const floor = P(0, 0, 0);
  const rip = Array.from({ length: Math.min(waiting, 4) }, (_, i) => ((t * 0.6 + i / Math.max(1, Math.min(waiting, 4))) % 1));

  return (
    <View {...pan.panHandlers} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Ellipse cx={floor.x} cy={floor.y} rx={74} ry={16} fill={tint} fillOpacity={0.08} stroke={tint} strokeOpacity={0.35} />
        {rip.map((k, i) => (
          <Ellipse key={i} cx={floor.x} cy={floor.y} rx={20 + k * 90} ry={(20 + k * 90) * 0.22} fill="none" stroke={tint} strokeOpacity={(1 - k) * 0.8} strokeWidth={1.5} />
        ))}
        <Ellipse cx={floor.x} cy={floor.y} rx={28} ry={6} fill="#000" fillOpacity={0.45} />
        {faces.map((f, i) => (
          <Polygon key={i} points={f.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill={tint} fillOpacity={0.25 + 0.6 * f.shade} stroke={f.shade === 1 ? '#ffffff' : tint} strokeOpacity={f.shade === 1 ? 0.5 : 0.8} strokeWidth={1} />
        ))}
        <G>
          <SvgText x={width * 0.58} y={height * 0.36} fill="#eef1f7" fontSize={44} fontWeight="900" fontFamily={SANS}>{waiting}</SvgText>
          <SvgText x={width * 0.58} y={height * 0.36 + 20} fill="#9ca3af" fontSize={12.5} fontWeight="700" fontFamily={SANS}>
            {waiting === 1 ? 'request needs' : 'requests need'}
          </SvgText>
          <SvgText x={width * 0.58} y={height * 0.36 + 36} fill="#9ca3af" fontSize={12.5} fontWeight="700" fontFamily={SANS}>your answer</SvgText>
          <SvgText x={width * 0.58} y={height * 0.36 + 60} fill={held ? '#fde68a' : '#6b7280'} fontSize={12.5} fontWeight="700" fontFamily={SANS}>
            {held ? `${held} held for pickup` : 'Nothing on hold'}
          </SvgText>
        </G>
      </Svg>
    </View>
  );
}
