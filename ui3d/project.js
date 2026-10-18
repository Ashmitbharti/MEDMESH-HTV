import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Tiny 3D helper for SVG scenes (no WebGL, so it runs the same on phones and the web preview).
// World: y is up, the ground is the x/z plane. The camera orbits by `yaw` and looks down by `pitch`.

export function makeCamera({ cx, cy, scale, yaw = 0, pitch = 0.5, dist = 6 }) {
  const cy_ = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return function project(x, y, z) {
    const x1 = x * cy_ - z * sy;
    const z1 = x * sy + z * cy_;
    const y2 = y * cp + z1 * sp;          // far ground points rise on screen (camera above, looking down)
    const z2 = -y * sp + z1 * cp;         // larger = further from the viewer
    const k = dist / (dist + z2);
    return { x: cx + x1 * scale * k, y: cy - y2 * scale * k, z: z2, k };
  };
}

// Polyline through 3D points -> SVG path, split into the near half and the far half (drawn dimmer).
export function splitPath(project, pts) {
  let near = '', far = '';
  for (let i = 1; i < pts.length; i++) {
    const a = project(...pts[i - 1]);
    const b = project(...pts[i]);
    const seg = `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    if ((a.z + b.z) / 2 > 0) far += seg; else near += seg;
  }
  return { near, far };
}

export const ring = (r, y = 0, n = 64) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  return [Math.cos(t) * r, y, Math.sin(t) * r];
});

export const toPath = (project, pts) => pts.map((p, i) => {
  const q = project(...p);
  return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
}).join('');

// Only the visible screen needs decorative motion. Mesh traffic keeps running separately.
export function useSceneActive() {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return focused && active;
}

// One timer for all visible scenes; one-second status labels don't run a 60 fps loop.
const clocks = new Set();
let clockTimer;
function scheduleClock() {
  clearTimeout(clockTimer);
  if (!clocks.size) return;
  const next = Math.min(...Array.from(clocks, (c) => c.next));
  clockTimer = setTimeout(() => {
    const now = Date.now();
    clocks.forEach((c) => {
      if (now >= c.next) {
        c.next = now + c.interval;
        c.tick(now);
      }
    });
    scheduleClock();
  }, Math.max(0, next - Date.now()));
}

export function useClock(running = true, fps = 30) {
  const active = useSceneActive();
  const elapsed = useRef(0);
  const [clock, setClock] = useState({ t: 0, now: 0 });
  useEffect(() => {
    if (!running || !active) return undefined;
    const start = Date.now();
    const c = {
      interval: 1000 / Math.max(1, fps), next: start,
      tick: (now) => setClock({ t: elapsed.current + (now - start) / 1000, now }),
    };
    clocks.add(c);
    scheduleClock();
    return () => {
      elapsed.current += (Date.now() - start) / 1000;
      clocks.delete(c);
      scheduleClock();
    };
  }, [running, fps, active]);
  return clock; // { t: seconds since mount, now: wall-clock ms }
}
