import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient as SvgGrad, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { makeCamera, useClock } from '../ui3d/project';
import { capOf, fullOf, LOW } from './pharmacyService';

// "The Shelf": the pharmacy's emergency stock as glass bottles on two 3D shelves. Liquid level = how much is left
// (compared with a normal full shelf for that item). Green = fine, amber = low, red = out. A red price tag means the
// price is above the fair cap. Tap a bottle to edit it; drag to look along the shelf. Bottles slosh when changed.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
export const SHORT = { INSULIN: 'Insulin', INHALER: 'Inhaler', EPIPEN: 'EpiPen', HEART: 'Heart', SEIZURE: 'Seizure', BP: 'BP meds', STRIPS: 'Strips', DRESS: 'Dressings', NEB: 'Nebuliser', O2: 'Oxygen', CPAPPWR: 'CPAP power' };
const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

export function levelOf(item, qty) {
  if (qty <= 0) return { tint: '#f43f5e', label: 'Out' };
  if (qty <= LOW(item)) return { tint: '#fbbf24', label: 'Low' };
  return { tint: '#34d399', label: 'OK' };
}

export default function StockShelf({ width, height = 300, items, selected, onSelect, open = true, bumpAt = 0 }) {
  const { t, now } = useClock(true, 30);
  const [drag, setDrag] = useState(0);
  const [g] = useState(() => ({ base: 0, live: 0 }));
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = Math.max(-0.55, Math.min(0.55, g.base + e.dx * 0.006)); setDrag(g.live); },
  }));
  const keys = Object.keys(items);
  const per = Math.ceil(keys.length / 2) || 1;
  const W = 3.6;
  const yaw = drag + Math.sin(t * 0.35) * 0.07;
  const P = makeCamera({ cx: width / 2, cy: height * 0.83, scale: Math.min(width / 4.3, 92), yaw, pitch: 0.2, dist: 7 });
  const shelves = [0, 1.32];
  const slosh = Math.max(0, 1 - (now - bumpAt) / 900);

  const plank = (y) => {
    const v = (x, yy, z) => P(x, yy, z);
    return (
      <G key={`p${y}`}>
        <Polygon points={poly([v(-W / 2, y, -0.35), v(W / 2, y, -0.35), v(W / 2, y, 0.35), v(-W / 2, y, 0.35)])} fill="#1e293b" stroke="#7dd3fc" strokeOpacity={0.25} />
        <Polygon points={poly([v(-W / 2, y, -0.35), v(W / 2, y, -0.35), v(W / 2, y - 0.08, -0.35), v(-W / 2, y - 0.08, -0.35)])} fill="#334155" />
      </G>
    );
  };

  const bottles = keys.map((k, i) => {
    const row = i < per ? 1 : 0;                    // first half on the top shelf
    const col = row ? i : i - per;
    const n = row ? per : keys.length - per;
    const x = -W / 2 + (W / n) * (col + 0.5);
    const lift = selected === k ? 0.1 + Math.sin(t * 3) * 0.02 : 0;
    const y = shelves[row] + lift;
    const b = P(x, y, 0);
    const top = P(x, y + 0.78, 0);
    const rx = 0.17 * b.k * Math.min(width / 4.3, 92);
    const ry = rx * 0.32;
    const { qty, price } = items[k];
    const lv = levelOf(k, qty);
    const frac = Math.min(1, qty / fullOf(k));
    const wob = selected === k ? Math.sin(t * 9) * slosh * 0.06 : 0;
    const liquidTop = b.y + (top.y - b.y) * Math.max(0.04, frac) * 0.92;
    const cap = capOf(k);
    const over = cap && price > cap;
    return { k, x, b, top, rx, ry, qty, lv, liquidTop, wob, over, z: b.z };
  });

  return (
    <View {...pan.panHandlers} style={{ width, height, opacity: open ? 1 : 0.55 }}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGrad id="glass" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
            <Stop offset="0.35" stopColor="#ffffff" stopOpacity="0.04" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0.12" />
          </SvgGrad>
        </Defs>
        {shelves.map(plank)}
        {bottles.sort((a, b) => b.z - a.z).map((o) => {
          const on = selected === o.k;
          const lx = o.b.x - o.rx;
          return (
            <G key={o.k} onPress={() => onSelect?.(o.k)}>
              {on ? <Ellipse cx={o.b.x} cy={o.b.y} rx={o.rx * 1.9} ry={o.ry * 1.9} fill="#7dd3fc" fillOpacity={0.18} /> : null}
              <Ellipse cx={o.b.x} cy={o.b.y} rx={o.rx} ry={o.ry} fill={o.lv.tint} fillOpacity={0.5} />
              <Rect x={lx} y={o.liquidTop} width={o.rx * 2} height={Math.max(0, o.b.y - o.liquidTop)} fill={o.lv.tint} fillOpacity={0.55} />
              <Ellipse cx={o.b.x} cy={o.liquidTop} rx={o.rx} ry={o.ry * (1 + o.wob * 6)} fill={o.lv.tint} fillOpacity={0.9} />
              <Rect x={lx} y={o.top.y} width={o.rx * 2} height={o.b.y - o.top.y} fill="url(#glass)" stroke={on ? '#e0f2fe' : '#94a3b8'} strokeOpacity={on ? 0.9 : 0.45} strokeWidth={1} />
              <Ellipse cx={o.b.x} cy={o.top.y} rx={o.rx} ry={o.ry} fill="#0b1020" fillOpacity={0.6} stroke="#94a3b8" strokeOpacity={0.5} />
              <Rect x={o.b.x - o.rx * 0.55} y={o.top.y - o.ry * 2.6} width={o.rx * 1.1} height={o.ry * 2.4} rx={2} fill="#e2e8f0" fillOpacity={0.85} />
              {/* price tag */}
              <Rect x={o.b.x + o.rx * 0.35} y={o.top.y + 6} width={o.rx * 1.1} height={9} rx={2} fill={o.over ? '#f43f5e' : '#34d399'} fillOpacity={0.9} />
              <SvgText x={o.b.x} y={o.b.y + o.ry + 14} fill={on ? '#eef1f7' : '#cbd5e1'} fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{SHORT[o.k] || o.k}</SvgText>
              <SvgText x={o.b.x} y={o.b.y + o.ry + 27} fill={o.lv.tint} fontSize={10.5} fontWeight="800" textAnchor="middle" fontFamily={SANS}>{o.qty} · {o.lv.label}</SvgText>
            </G>
          );
        })}
        {!open ? <SvgText x={width / 2} y={22} fill="#fda4af" fontSize={13} fontWeight="900" textAnchor="middle" fontFamily={SANS}>CLOSED · not receiving requests</SvgText> : null}
      </Svg>
    </View>
  );
}
