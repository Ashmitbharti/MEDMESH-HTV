// Small helpers for the government 3D scenes (SVG, no WebGL).

export const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

// An n-sided prism standing on the ground at (cx, cz): visible side faces + top, in screen space.
export function prism(P, cx, cz, r, h, yaw, n = 6, y0 = 0) {
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r, a];
  });
  const sides = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const am = (p[2] + q[2]) / 2 + (i === n - 1 ? Math.PI : 0);
    const nx = Math.cos(am), nz = Math.sin(am);                 // outward normal of this face
    if (nx * Math.sin(yaw) + nz * Math.cos(yaw) < 0) {
      sides.push({ pts: [P(p[0], y0, p[1]), P(q[0], y0, q[1]), P(q[0], y0 + h, q[1]), P(p[0], y0 + h, p[1])], shade: 0.55 + 0.35 * Math.abs(nx) });
    }
  }
  return { sides, top: ring.map(([x, z]) => P(x, y0 + h, z)), base: ring.map(([x, z]) => P(x, y0, z)) };
}

export function dragYaw(PanResponder, g, setDrag, k = 0.01) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, e) => Math.abs(e.dx) > 6 && Math.abs(e.dx) > Math.abs(e.dy),
    onPanResponderGrant: () => { g.base = g.live; },
    onPanResponderMove: (_, e) => { g.live = g.base + e.dx * k; setDrag(g.live); },
  });
}
