import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useClock } from '../ui3d/project';

// One animated pseudo-3D illustration per guide: a glowing tilted pedestal (same language as the Shield) with the
// guide's own scene floating above it. Pure SVG, so it runs offline on phones and the web.

function Pedestal({ w, h, tint, t }) {
  const cx = w / 2;
  const cy = h * 0.8;
  const pulse = (t % 2) / 2;
  return (
    <G>
      <Ellipse cx={cx} cy={cy} rx={w * 0.42} ry={h * 0.1} fill="url(#floor)" />
      <Ellipse cx={cx} cy={cy} rx={w * 0.34} ry={h * 0.08} stroke={tint} strokeOpacity={0.45} fill="none" />
      <Ellipse cx={cx} cy={cy} rx={w * 0.2} ry={h * 0.048} stroke={tint} strokeOpacity={0.3} fill="none" />
      <Ellipse cx={cx} cy={cy} rx={w * (0.2 + pulse * 0.25)} ry={h * (0.048 + pulse * 0.06)} stroke={tint} strokeOpacity={(1 - pulse) * 0.5} fill="none" />
    </G>
  );
}

const S = 'rgba(255,255,255,0.9)';

function Scene({ id, w, h, tint, t }) {
  const cx = w / 2;
  const top = h * 0.18;
  const bob = Math.sin(t * 2) * 3;
  const beat = (t * 110 / 60) % 1;                 // 110 per minute
  const press = beat < 0.3 ? Math.sin((beat / 0.3) * Math.PI) : 0;
  switch (id) {
    case 'cpr': {
      const y = top + 34 + press * 10;
      return (
        <G>
          <Ellipse cx={cx} cy={top + 70} rx={w * 0.26} ry={h * 0.11} fill={tint} fillOpacity={0.14} stroke={tint} strokeOpacity={0.6} />
          {[0, 1, 2].map((i) => <Ellipse key={i} cx={cx} cy={top + 70} rx={w * (0.08 + i * 0.06) * (1 + press * 0.15)} ry={h * (0.03 + i * 0.022) * (1 + press * 0.15)} stroke={tint} strokeOpacity={0.55 - i * 0.15} fill="none" />)}
          <Rect x={cx - 22} y={y} width={44} height={16} rx={8} fill={S} />
          <Rect x={cx - 18} y={y - 14} width={36} height={16} rx={8} fill={S} fillOpacity={0.8} />
          <Circle cx={cx} cy={y - 62} r={10} fill={S} />
          <Rect x={cx - 30} y={y - 50} width={60} height={12} rx={6} fill={S} fillOpacity={0.85} />
          <Line x1={cx - 24} y1={y - 42} x2={cx - 12} y2={y - 12} stroke={S} strokeWidth={8} strokeLinecap="round" />
          <Line x1={cx + 24} y1={y - 42} x2={cx + 12} y2={y - 12} stroke={S} strokeWidth={8} strokeLinecap="round" />
        </G>
      );
    }
    case 'bleeding': {
      const p = 0.5 + 0.5 * Math.sin(t * 3);
      return (
        <G transform={`translate(0 ${bob})`}>
          <Rect x={cx - w * 0.3} y={top + 52} width={w * 0.6} height={30} rx={15} fill="#fecaca" fillOpacity={0.85} transform={`rotate(-8 ${cx} ${top + 67})`} />
          <Rect x={cx - 26} y={top + 40 + p * 4} width={52} height={22} rx={6} fill="#f8fafc" />
          <Rect x={cx - 20} y={top + 14 + p * 4} width={40} height={30} rx={12} fill={S} fillOpacity={0.85} />
          {[0, 1, 2].map((i) => <Circle key={i} cx={cx + 34 + i * 9} cy={top + 82 + ((t * 30 + i * 12) % 30)} r={3} fill={tint} fillOpacity={1 - ((t * 30 + i * 12) % 30) / 30} />)}
        </G>
      );
    }
    case 'choking': {
      const blow = (t % 1.2) < 0.2;
      return (
        <G transform={`translate(0 ${bob})`}>
          <Circle cx={cx} cy={top + 18} r={14} fill={S} />
          <Rect x={cx - 20} y={top + 34} width={40} height={52} rx={16} fill={S} fillOpacity={0.85} />
          <Path d={`M${cx + 34},${top + 50} l${blow ? -14 : -4},0`} stroke={tint} strokeWidth={6} strokeLinecap="round" />
          <Path d={`M${cx + 26},${top + 42} l8,8 l-8,8`} stroke={tint} strokeWidth={4} fill="none" strokeOpacity={blow ? 1 : 0.4} />
          <Circle cx={cx} cy={top + 72} r={7} stroke={tint} strokeWidth={3} fill="none" strokeOpacity={blow ? 0.4 : 1} />
        </G>
      );
    }
    case 'burns': {
      return (
        <G>
          <Rect x={cx - 10} y={top} width={20} height={10} rx={3} fill="#94a3b8" />
          {[0, 1, 2, 3].map((i) => <Line key={i} x1={cx - 6 + i * 4} y1={top + 10} x2={cx - 6 + i * 4} y2={top + 64} stroke="#7dd3fc" strokeWidth={2.5} strokeDasharray="6 6" strokeDashoffset={-((t * 60) % 12)} strokeOpacity={0.9} />)}
          <Rect x={cx - w * 0.28} y={top + 64} width={w * 0.56} height={26} rx={13} fill="#fde68a" fillOpacity={0.85} />
          <Ellipse cx={cx} cy={top + 77} rx={14} ry={6} fill={tint} fillOpacity={0.4 + 0.3 * Math.sin(t * 2)} />
        </G>
      );
    }
    case 'fracture': {
      return (
        <G transform={`translate(0 ${bob})`}>
          <Rect x={cx - w * 0.28} y={top + 48} width={w * 0.56} height={24} rx={12} fill={S} fillOpacity={0.85} />
          <Path d={`M${cx - 4},${top + 48} l6,10 l-5,4 l6,10`} stroke={tint} strokeWidth={3} fill="none" />
          <Rect x={cx - w * 0.3} y={top + 40} width={w * 0.6} height={6} rx={3} fill="#a16207" />
          <Rect x={cx - w * 0.3} y={top + 74} width={w * 0.6} height={6} rx={3} fill="#a16207" />
          <Rect x={cx + 18} y={top + 18} width={30} height={20} rx={6} fill="#bae6fd" fillOpacity={0.6 + 0.3 * Math.sin(t * 2)} />
        </G>
      );
    }
    case 'recovery': {
      const br = 1 + 0.04 * Math.sin(t * 2.2);
      return (
        <G transform={`translate(${cx} ${top + 60}) scale(${br}) translate(${-cx} ${-(top + 60)})`}>
          <Circle cx={cx - 46} cy={top + 52} r={13} fill={S} />
          <Rect x={cx - 34} y={top + 44} width={64} height={26} rx={13} fill={S} fillOpacity={0.85} />
          <Path d={`M${cx + 28},${top + 66} l26,-14 l8,22`} stroke={S} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity={0.85} />
          <Circle cx={cx - 60} cy={top + 44} r={4 + 3 * Math.sin(t * 2.2)} fill={tint} fillOpacity={0.7} />
        </G>
      );
    }
    case 'hypothermia': {
      return (
        <G transform={`translate(0 ${bob})`}>
          <Circle cx={cx} cy={top + 46} r={42 + 4 * Math.sin(t * 2)} fill="#fb923c" fillOpacity={0.12} />
          <Circle cx={cx} cy={top + 22} r={13} fill={S} />
          <Path d={`M${cx - 30},${top + 40} q30,-14 60,0 l4,46 q-34,10 -68,0 z`} fill={tint} fillOpacity={0.8} />
          <Path d={`M${cx - 24},${top + 52} q24,-8 48,0`} stroke="#fff" strokeOpacity={0.5} fill="none" />
        </G>
      );
    }
    case 'drowning': {
      const wave = (k) => {
        let d = `M${cx - w * 0.36},${top + k}`;
        for (let x = 0; x <= w * 0.72; x += 8) d += ` L${cx - w * 0.36 + x},${top + k + Math.sin(x / 12 + t * 3) * 4}`;
        return d;
      };
      return (
        <G>
          <Path d={wave(70)} stroke="#22d3ee" strokeWidth={3} fill="none" />
          <Path d={wave(82)} stroke="#22d3ee" strokeOpacity={0.5} strokeWidth={3} fill="none" />
          <G transform={`translate(0 ${Math.sin(t * 2) * 4})`}>
            <Circle cx={cx} cy={top + 58} r={20} stroke="#f97316" strokeWidth={9} fill="none" />
            <Circle cx={cx} cy={top + 58} r={20} stroke="#fff" strokeWidth={9} strokeDasharray="10 21" fill="none" />
          </G>
        </G>
      );
    }
    case 'lowsugar': {
      return (
        <G>
          <Path d={`M${cx},${top + 6 + bob} q20,28 20,42 a20,20 0 1 1 -40,0 q0,-14 20,-42 z`} fill={tint} fillOpacity={0.85} />
          {[0, 1, 2].map((i) => <Rect key={i} x={cx + 28 + i * 14} y={top + 70 - Math.abs(Math.sin(t * 3 + i)) * 12} width={12} height={12} rx={2} fill="#fff" fillOpacity={0.9} />)}
        </G>
      );
    }
    case 'oxygen': {
      const a = -0.8 + 0.4 * Math.sin(t * 1.5);
      return (
        <G transform={`translate(0 ${bob})`}>
          <Rect x={cx - 16} y={top + 18} width={32} height={68} rx={14} fill={tint} fillOpacity={0.85} />
          <Rect x={cx - 6} y={top + 6} width={12} height={14} rx={3} fill="#94a3b8" />
          <Circle cx={cx + 34} cy={top + 32} r={16} fill="#0b1020" stroke="#fff" strokeWidth={2} />
          <Line x1={cx + 34} y1={top + 32} x2={cx + 34 + Math.cos(a) * 11} y2={top + 32 + Math.sin(a) * 11} stroke="#fbbf24" strokeWidth={2.5} strokeLinecap="round" />
        </G>
      );
    }
    default:
      return <Circle cx={cx} cy={top + 50} r={24} fill={tint} />;
  }
}

export default function GuideArt({ id, tint = '#38bdf8', width = 160, height = 140, still = false }) {
  const { t } = useClock(!still, 30);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id="floor" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={tint} stopOpacity="0.35" />
          <Stop offset="1" stopColor={tint} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Pedestal w={width} h={height} tint={tint} t={t} />
      <G transform={`scale(${width / 220})`}>
        <Scene id={id} w={220} h={height * (220 / width)} tint={tint} t={t} />
      </G>
    </Svg>
  );
}
