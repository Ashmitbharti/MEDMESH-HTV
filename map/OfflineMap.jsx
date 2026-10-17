import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { useClock } from '../ui3d/project';
import { c } from '../medmesh-id/theme';

// Offline street map drawn from road geometry (no map tiles, no internet). Fits the view around the person, the
// ambulance and the hospital, and draws the trip: ambulance -> you -> hospital.

const SANS = 'Inter, -apple-system, Segoe UI, Roboto, sans-serif';
const ROAD = { motorway: [5, '#6d5f86'], trunk: [4.5, '#5b5884'], primary: [3.6, '#40527a'], secondary: [3, '#36456a'], tertiary: [2.4, '#303d5c'], residential: [1.6, '#273149'], service: [1.1, '#202838'] };

export default function OfflineMap({ geo, you, amb, hosp, phase = 'P', width, height = 260 }) {
  const { t } = useClock(true, 20);
  const pts = [you, amb, hosp].filter((p) => p && p.lat != null);
  const key = pts.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|');

  const view = useMemo(() => {
    const lat0 = pts.length ? pts.reduce((a, p) => a + p.lat, 0) / pts.length : 43.78;
    const lon0 = pts.length ? pts.reduce((a, p) => a + p.lon, 0) / pts.length : -79.2;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const ky = 110540;
    const xs = pts.map((p) => (p.lon - lon0) * kx);
    const ys = pts.map((p) => -(p.lat - lat0) * ky);
    const span = Math.max(1200, Math.max(...xs, 0) - Math.min(...xs, 0), (Math.max(...ys, 0) - Math.min(...ys, 0)) * (width / height)) * 1.35;
    const s = width / span;
    const cx = ((Math.max(...xs, 0) + Math.min(...xs, 0)) / 2);
    const cy = ((Math.max(...ys, 0) + Math.min(...ys, 0)) / 2);
    const P = (lat, lon) => [width / 2 + ((lon - lon0) * kx - cx) * s, height / 2 + (-(lat - lat0) * ky - cy) * s];
    return { P, s };
  }, [key, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const { P, s } = view;
  const roads = useMemo(() => (geo?.roads || []).map((r) => ({
    cls: r.cls, name: r.name, d: r.g.map(([la, lo], i) => { const [x, y] = P(la, lo); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(''),
    mid: P(...r.g[Math.floor(r.g.length / 2)]),
  })), [geo, P]);
  const water = useMemo(() => (geo?.areas?.water || []).map((poly) => poly.map(([la, lo]) => P(la, lo).join(',')).join(' ')), [geo, P]);
  const labels = useMemo(() => {
    const seen = new Set();
    return roads.filter((r) => ['primary', 'trunk', 'motorway', 'secondary'].includes(r.cls) && r.name && r.name !== 'unnamed road'
      && r.mid[0] > 30 && r.mid[0] < width - 30 && r.mid[1] > 14 && r.mid[1] < height - 10 && !seen.has(r.name) && seen.add(r.name)).slice(0, 6);
  }, [roads, width, height]);

  const Y = you && P(you.lat, you.lon);
  const A = amb && P(amb.lat, amb.lon);
  const Hh = hosp && P(hosp.lat, hosp.lon);
  const pulse = (t % 1.6) / 1.6;
  const dash = -((t * 30) % 20);

  return (
    <View style={{ width, height, borderRadius: 20, overflow: 'hidden', backgroundColor: '#0a0f1c' }}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="#0a0f1c" />
        {water.map((p, i) => <Polygon key={i} points={p} fill="#0c2742" stroke="#14406b" strokeWidth={1} />)}
        {roads.map((r, i) => {
          const [w, col] = ROAD[r.cls] || ROAD.residential;
          return <Path key={i} d={r.d} stroke={col} strokeWidth={Math.max(1, w * Math.min(1.6, s * 120))} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
        })}
        {labels.map((r) => (
          <SvgText key={r.name} x={r.mid[0]} y={r.mid[1] - 4} fill="#94a3b8" fontSize={9.5} fontWeight="600" textAnchor="middle" fontFamily={SANS}>{r.name}</SvgText>
        ))}

        {/* trip */}
        {A && Y && phase === 'P' ? <Line x1={A[0]} y1={A[1]} x2={Y[0]} y2={Y[1]} stroke={c.amber} strokeWidth={3} strokeDasharray="6 6" strokeDashoffset={dash} /> : null}
        {Y && Hh ? <Line x1={(phase === 'H' && A ? A : Y)[0]} y1={(phase === 'H' && A ? A : Y)[1]} x2={Hh[0]} y2={Hh[1]} stroke={c.sky} strokeOpacity={phase === 'H' ? 1 : 0.45} strokeWidth={3} strokeDasharray="6 6" strokeDashoffset={phase === 'H' ? dash : 0} /> : null}

        {Hh ? (
          <G>
            <Circle cx={Hh[0]} cy={Hh[1]} r={14} fill="#0a0f1c" stroke={c.redl} strokeWidth={2.5} />
            <SvgText x={Hh[0]} y={Hh[1] + 5.5} fill={c.redl} fontSize={16} fontWeight="900" textAnchor="middle" fontFamily={SANS}>+</SvgText>
          </G>
        ) : null}
        {Y && phase !== 'H' ? (
          <G>
            <Circle cx={Y[0]} cy={Y[1]} r={8 + pulse * 22} fill={c.sky} fillOpacity={(1 - pulse) * 0.25} />
            <Circle cx={Y[0]} cy={Y[1]} r={8} fill={c.sky} stroke="#fff" strokeWidth={2.5} />
          </G>
        ) : null}
        {A ? (
          <G>
            <Circle cx={A[0]} cy={A[1]} r={16} fill={c.amber} fillOpacity={0.18} />
            <Rect x={A[0] - 13} y={A[1] - 9} width={26} height={18} rx={5} fill={c.amber} />
            <SvgText x={A[0]} y={A[1] + 4} fill="#111827" fontSize={9} fontWeight="900" textAnchor="middle" fontFamily={SANS}>EMS</SvgText>
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
