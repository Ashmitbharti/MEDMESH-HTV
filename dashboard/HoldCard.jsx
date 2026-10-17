import { useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import s from './Dashboard.styles';

// Press and hold for 3 seconds (stops accidental SOS). Releasing early cancels.
const HOLD_MS = 3000;

export default function HoldCard({ title, sub, icon: Icon, colors, accent, primary, disabled, onComplete }) {
  const [p] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);
  const [left, setLeft] = useState(3);
  const [frac, setFrac] = useState(0);   // ring progress (a plain value: animated SVG props warn on web)
  const anim = useRef(null);
  const timer = useRef(null);

  function start() {
    if (disabled) return;
    setHolding(true);
    setLeft(3);
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const el = Date.now() - t0;
      setLeft(Math.max(1, 3 - Math.floor(el / 1000)));
      setFrac(Math.min(1, el / HOLD_MS));
    }, 40);
    anim.current = Animated.timing(p, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      clearInterval(timer.current);
      setHolding(false);
      setFrac(0);
      p.setValue(0);
      if (finished) onComplete();
    });
  }

  function stop() {
    anim.current?.stop();
    clearInterval(timer.current);
    setFrac(0);
  }

  const size = primary ? 64 : 50;
  const r = size / 2 - 3;
  const circ = 2 * Math.PI * r;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Press and hold for three seconds. Release early to cancel."
      accessibilityState={{ disabled: !!disabled }}
      onPressIn={start}
      onPressOut={stop}
      style={({ pressed }) => [primary ? s.holdPrimary : s.holdSecondary, pressed && { transform: [{ scale: 0.985 }] }, disabled && { opacity: 0.5 }]}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={primary ? s.holdFillPrimary : s.holdFill}>
        <Animated.View pointerEvents="none" style={[s.holdSweep, {
          backgroundColor: accent + '33',
          width: p.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]} />
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth={3} fill="none" />
            <Circle cx={size / 2} cy={size / 2} r={r} stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round"
              strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - frac)} />
          </Svg>
          {holding ? <Text style={s.holdCount}>{left}</Text> : <Icon size={primary ? 26 : 21} color="#fff" strokeWidth={2.4} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={primary ? s.holdTitlePrimary : s.holdTitle}>{title}</Text>
          <Text style={s.holdSub}>{holding ? 'Keep holding…  release to cancel' : sub}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
