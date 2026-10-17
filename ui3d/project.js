import { useEffect, useState } from 'react';

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

// Shared animation clock: one requestAnimationFrame loop, ~30 fps.

export function useClock(running = true, fps = 30) {
  const [clock, setClock] = useState({ t: 0, now: 0 });
  useEffect(() => {
    if (!running) return undefined;
    let raf;
    let last = 0;
    const start = Date.now();
    const loop = () => {
      const now = Date.now();
      if (now - last >= 1000 / fps) { last = now; setClock({ t: (now - start) / 1000, now }); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, fps]);
  return clock; // { t: seconds since mount, now: wall-clock ms }
}
