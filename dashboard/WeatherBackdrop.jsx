import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { HAZARDS } from './hazardService';
import { useSceneActive } from '../ui3d/project';

// Full-screen animated weather behind the dashboard. All motion uses the native driver (transform/opacity only).

// Animated.loop with the native driver does not repeat on react-native-web, so use the JS driver there.
const NATIVE = Platform.OS !== 'web';

function rng(seed) {
  let x = seed;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}

const CONFIG = {
  storm: { rain: 70, speed: [520, 760], len: [16, 28], slant: 16, lightning: true },
  rain: { rain: 46, speed: [700, 1000], len: [12, 20], slant: 10 },
  flood: { rain: 40, speed: [650, 900], len: [12, 22], slant: 12, waves: true },
  snow: { snow: 55 },
  fire: { embers: 34 },
  quake: { dust: 26 },
  calm: { blobs: true },
};

function useLoop(duration, delay, easing = Easing.linear) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let loop;
    const t = setTimeout(() => {
      loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: NATIVE, isInteraction: false }));
      loop.start();
    }, delay);
    return () => { clearTimeout(t); loop?.stop(); };
  }, [v, duration, delay, easing]);
  return v;
}

function Drop({ p, H }) {
  const v = useLoop(p.dur, p.delay);
  const dx = -Math.tan((p.slant * Math.PI) / 180) * (H + 80);
  return (
    <Animated.View style={[st.drop, {
      left: p.x, height: p.len, opacity: p.o,
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-60, H + 20] }) },
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
        { rotate: `${p.slant}deg` },
      ],
    }]} />
  );
}

function Flake({ p, H }) {
  const v = useLoop(p.dur, p.delay);
  return (
    <Animated.View style={[st.flake, {
      left: p.x, width: p.size, height: p.size, borderRadius: p.size, opacity: p.o,
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-20, H + 20] }) },
        { translateX: v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, p.sway, 0, -p.sway, 0] }) },
      ],
    }]} />
  );
}

function Ember({ p, H }) {
  const v = useLoop(p.dur, p.delay, Easing.out(Easing.quad));
  return (
    <Animated.View style={[st.ember, {
      left: p.x, width: p.size, height: p.size, borderRadius: p.size, backgroundColor: p.color,
      opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, p.o, p.o * 0.6, 0] }),
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [H + 10, H * 0.25] }) },
        { translateX: v.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0, p.sway, -p.sway * 0.6, p.sway * 0.4] }) },
      ],
    }]} />
  );
}

function Dust({ p, H }) {
  const v = useLoop(p.dur, p.delay, Easing.inOut(Easing.sin));
  return (
    <Animated.View style={[st.flake, {
      left: p.x, top: p.y * H, width: p.size, height: p.size, borderRadius: p.size, backgroundColor: '#c4b5fd',
      opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.o, 0] }),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) }],
    }]} />
  );
}

function Blob({ color, size, x, y, dur, delay }) {
  const v = useLoop(dur, delay, Easing.inOut(Easing.sin));
  return (
    <Animated.View style={{
      position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: color,
      transform: [
        { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 40, 0] }) },
        { translateY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 25, 0] }) },
        { scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.15, 1] }) },
      ],
    }} />
  );
}

function Waves({ W, H }) {
  const a = useLoop(5200, 0);
  const b = useLoop(7600, 0);
  const wave = (amp, len, y) => {
    let d = `M0,${y}`;
    for (let x = 0; x <= W * 2; x += 10) d += `L${x},${(y + Math.sin((x / len) * Math.PI * 2) * amp).toFixed(1)}`;
    return `${d}L${W * 2},${H}L0,${H}Z`;
  };
  const h = 150;
  return (
    <View style={[st.waves, { height: h }]} pointerEvents="none">
      <Animated.View style={{ position: 'absolute', width: W * 2, height: h, transform: [{ translateX: b.interpolate({ inputRange: [0, 1], outputRange: [-W / 2, 0] }) }] }}>
        <Svg width={W * 2} height={h}><Path d={wave(9, W / 2, 40)} fill="#0ea5e9" fillOpacity={0.14} /></Svg>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', width: W * 2, height: h, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, -W / 2] }) }] }}>
        <Svg width={W * 2} height={h}><Path d={wave(7, W / 4, 70)} fill="#38bdf8" fillOpacity={0.16} /></Svg>
      </Animated.View>
    </View>
  );
}

function Lightning({ W, H, onFlash }) {
  const [o] = useState(() => new Animated.Value(0));
  const [bolt, setBolt] = useState('');
  useEffect(() => {
    let alive = true;
    let timer;
    const strike = () => {
      if (!alive) return;
      const r = Math.random;
      let x = W * (0.15 + r() * 0.7);
      let y = 0;
      let d = `M${x},0`;
      while (y < H * 0.45) { y += 18 + r() * 26; x += (r() - 0.5) * 46; d += `L${x.toFixed(0)},${y.toFixed(0)}`; }
      setBolt(d);
      onFlash?.();
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 60, useNativeDriver: NATIVE }),
        Animated.timing(o, { toValue: 0.15, duration: 90, useNativeDriver: NATIVE }),
        Animated.timing(o, { toValue: 0.8, duration: 60, useNativeDriver: NATIVE }),
        Animated.timing(o, { toValue: 0, duration: 420, useNativeDriver: NATIVE }),
      ]).start();
      timer = setTimeout(strike, 3800 + Math.random() * 5200);
    };
    timer = setTimeout(strike, 1200);
    return () => { alive = false; clearTimeout(timer); };
  }, [W, H, o, onFlash]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: o }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(199,210,254,0.16)' }]} />
      <Svg width={W} height={H}>
        <Path d={bolt} stroke="#e0e7ff" strokeWidth={6} strokeOpacity={0.25} fill="none" />
        <Path d={bolt} stroke="#ffffff" strokeWidth={2} fill="none" />
      </Svg>
    </Animated.View>
  );
}

export default function WeatherBackdrop(props) {
  const active = useSceneActive();
  return active ? <WeatherScene {...props} /> : null;
}

function WeatherScene({ kind = 'calm', onFlash }) {
  const { width: W, height: H } = useWindowDimensions();
  const cfg = CONFIG[kind] || CONFIG.calm;
  const tint = (HAZARDS[kind] || HAZARDS.calm).tint;

  const parts = useMemo(() => {
    const r = rng(7 + kind.length * 31);
    const between = ([a, b]) => a + r() * (b - a);
    return {
      rain: Array.from({ length: cfg.rain || 0 }, () => ({
        x: r() * (W + 120), len: between(cfg.len), dur: between(cfg.speed), delay: r() * 1200, o: 0.25 + r() * 0.45, slant: cfg.slant,
      })),
      snow: Array.from({ length: cfg.snow || 0 }, () => ({
        x: r() * W, size: 2 + r() * 4, dur: 7000 + r() * 6000, delay: r() * 8000, o: 0.4 + r() * 0.5, sway: 10 + r() * 24,
      })),
      embers: Array.from({ length: cfg.embers || 0 }, () => ({
        x: r() * W, size: 2 + r() * 3.5, dur: 4200 + r() * 4200, delay: r() * 5000, o: 0.55 + r() * 0.45, sway: 14 + r() * 30,
        color: r() > 0.5 ? '#fb923c' : '#fbbf24',
      })),
      dust: Array.from({ length: cfg.dust || 0 }, () => ({
        x: r() * W, y: r(), size: 1.5 + r() * 2.5, dur: 3000 + r() * 4000, delay: r() * 3000, o: 0.25 + r() * 0.4,
      })),
    };
  }, [kind, W, cfg]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={tint} style={[StyleSheet.absoluteFill, { height: H * 0.75 }]} />
      {kind === 'fire' ? <LinearGradient colors={['rgba(5,7,15,0)', 'rgba(234,88,12,0.28)']} style={[StyleSheet.absoluteFill, { top: H * 0.45 }]} /> : null}
      {cfg.blobs ? (
        <>
          <Blob color="rgba(56,189,248,0.10)" size={W * 0.9} x={-W * 0.3} y={-W * 0.2} dur={14000} delay={0} />
          <Blob color="rgba(52,211,153,0.07)" size={W * 0.8} x={W * 0.4} y={H * 0.25} dur={18000} delay={500} />
        </>
      ) : null}
      {parts.rain.map((p, i) => <Drop key={`r${i}`} p={p} H={H} />)}
      {parts.snow.map((p, i) => <Flake key={`s${i}`} p={p} H={H} />)}
      {parts.embers.map((p, i) => <Ember key={`e${i}`} p={p} H={H} />)}
      {parts.dust.map((p, i) => <Dust key={`d${i}`} p={p} H={H} />)}
      {cfg.waves ? <Waves W={W} H={H} /> : null}
      {cfg.lightning ? <Lightning W={W} H={H} onFlash={onFlash} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  drop: { position: 'absolute', top: 0, width: 1.4, borderRadius: 1, backgroundColor: '#bae6fd' },
  flake: { position: 'absolute', top: 0, backgroundColor: '#f0f9ff' },
  ember: { position: 'absolute', top: 0 },
  waves: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
