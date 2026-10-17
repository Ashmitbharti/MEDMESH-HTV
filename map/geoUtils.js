// Nearest named road to a point, from the offline map's road geometry (metres, local flat projection).
export function nearestRoad(geo, lat, lon, maxM = 400) {
  if (!geo?.roads) return null;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = null;
  for (const r of geo.roads) {
    if (!r.name || r.name === 'unnamed road') continue;
    for (let i = 1; i < r.g.length; i++) {
      const ax = (r.g[i - 1][1] - lon) * kx; const ay = (r.g[i - 1][0] - lat) * ky;
      const bx = (r.g[i][1] - lon) * kx; const by = (r.g[i][0] - lat) * ky;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d <= maxM && (!best || d < best.dist)) best = { name: r.name, dist: Math.round(d) };
    }
  }
  return best;
}
