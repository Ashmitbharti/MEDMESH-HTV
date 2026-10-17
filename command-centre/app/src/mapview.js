// MedMesh offline street map: a small canvas renderer for OpenStreetMap data (no tiles, no internet).
// Used by the command-centre dashboard and the responder app.
const STYLE = {
  bg: "#0a0f1c", water: "#0c2742", waterEdge: "#14406b", park: "#0e2620", building: "#151d2d",
  casing: "#04060c", label: "#c7d2fe", labelHalo: "#0a0f1c",
  road: { motorway: ["#7a6a8f", 15, 3], trunk: ["#5f5a85", 12, 2.6], primary: ["#4b5d80", 11, 2.4], secondary: ["#3e4d6c", 10, 2], tertiary: ["#36435e", 9, 1.6], residential: ["#2b354b", 7, 1.1], service: ["#232b3d", 5, .8] },
  route: "#3b82f6", routeCasing: "#dbeafe", pickup: "#38bdf8", jam: "#ef4444", slow: "#f59e0b",
};
const CLS_ORDER = ["service", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"];

export class MedMap {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.opts = opts;
    this.geo = null; this.ov = {}; this.view = { cx: 0, cy: 0, s: 0.05 }; this.dirty = true; this.t0 = performance.now();
    this.onClick = opts.onClick || null;
    this._bind(); this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement || canvas);
    const loop = () => { if (this.dirty || this._animating()) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------- projection (local equirectangular, metres)
  setData(geo) {
    this.geo = geo;
    const pts = geo.roads.flatMap((r) => r.g);
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    this.lat0 = (Math.min(...lats) + Math.max(...lats)) / 2; this.lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
    this.kx = 111320 * Math.cos(this.lat0 * Math.PI / 180); this.ky = 110540;
    const P = (p) => [(p[1] - this.lon0) * this.kx, -(p[0] - this.lat0) * this.ky];
    this.roads = geo.roads.map((r) => ({ ...r, xy: r.g.map(P) })).sort((a, b) => CLS_ORDER.indexOf(a.cls) - CLS_ORDER.indexOf(b.cls));
    this.byIdx = new Map(this.roads.map((r) => [r.i, r]));
    this.areas = {}; for (const k of ["water", "parks", "buildings"]) this.areas[k] = (geo.areas?.[k] || []).map((poly) => poly.map(P));
    // label candidates: longest run per road name
    const best = {};
    this.roads.forEach((r) => { if (r.name === "unnamed road") return; const L = len(r.xy); if (!best[r.name] || L > best[r.name].L) best[r.name] = { r, L }; });
    this.labelCands = Object.values(best).map((b) => b.r);
    const xs = this.roads.flatMap((r) => r.xy.map((p) => p[0])), ys = this.roads.flatMap((r) => r.xy.map((p) => p[1]));
    this.bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    this.fit(); this.dirty = true;
  }
  P(lat, lon) { return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * this.ky]; }
  unP(x, y) { return [this.lat0 - y / this.ky, this.lon0 + x / this.kx]; }
  toScreen(x, y) { return [(x - this.view.cx) * this.view.s + this.w / 2, (y - this.view.cy) * this.view.s + this.h / 2]; }
  fromScreen(sx, sy) { return [(sx - this.w / 2) / this.view.s + this.view.cx, (sy - this.h / 2) / this.view.s + this.view.cy]; }

  fit(coords) {
    this._fitTarget = coords || null;
    let b = this.bounds;
    if (coords && coords.length) { const xy = coords.map((c) => this.P(c[0], c[1])); b = [Math.min(...xy.map((p) => p[0])), Math.min(...xy.map((p) => p[1])), Math.max(...xy.map((p) => p[0])), Math.max(...xy.map((p) => p[1]))]; }
    if (!b || !this.w) return;
    const pad = coords ? 70 : 20;
    this.view.cx = (b[0] + b[2]) / 2; this.view.cy = (b[1] + b[3]) / 2;
    this.view.s = Math.min((this.w - pad * 2) / Math.max(b[2] - b[0], 200), (this.h - pad * 2) / Math.max(b[3] - b[1], 200));
    this.dirty = true;
  }
  setOverlay(ov) { this.ov = ov || {}; this.dirty = true; }

  // ---------- interaction: drag, wheel, pinch, click
  _bind() {
    const c = this.c, ptrs = new Map(); let start = null, moved = false, pinch = null;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); start = { x: e.offsetX, y: e.offsetY, cx: this.view.cx, cy: this.view.cy }; moved = false;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.view.s }; } });
    c.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; this.view.s = clamp(pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, 0.003, 3); moved = true; this.dirty = true; return; }
      const dx = e.offsetX - start.x, dy = e.offsetY - start.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      this.view.cx = start.cx - dx / this.view.s; this.view.cy = start.cy - dy / this.view.s; this.dirty = true;
    });
    const up = (e) => { if (!moved && ptrs.size === 1 && this.onClick) { const [x, y] = this.fromScreen(e.offsetX, e.offsetY); this.onClick(this.unP(x, y), this._hit(e.offsetX, e.offsetY)); } ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", (e) => ptrs.delete(e.pointerId));
    c.addEventListener("wheel", (e) => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); const [mx, my] = this.fromScreen(e.offsetX, e.offsetY);
      this.view.s = clamp(this.view.s * k, 0.003, 3); this.view.cx = mx - (e.offsetX - this.w / 2) / this.view.s; this.view.cy = my - (e.offsetY - this.h / 2) / this.view.s; this.dirty = true; }, { passive: false });
  }
  _hit(sx, sy) { return (this._markerHits || []).find((m) => Math.hypot(m.x - sx, m.y - sy) < 16)?.m || null; }
  _resize() { const r = this.c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); this.w = r.width; this.h = r.height; this.c.width = r.width * d; this.c.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); if (this.geo && this.w) this.fit(this._fitTarget); this.dirty = true; }
  _animating() { return (this.ov.markers || []).some((m) => m.pulse) || (this.ov.routes || []).some((r) => r.flow); }

  // ---------- drawing
  draw() {
    this.dirty = false;
    const g = this.ctx, s = this.view.s, t = (performance.now() - this.t0) / 1000;
    g.fillStyle = STYLE.bg; g.fillRect(0, 0, this.w, this.h);
    if (!this.geo) return;
    const path = (xy) => { g.beginPath(); xy.forEach((p, i) => { const q = this.toScreen(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); };
    // areas
    g.fillStyle = STYLE.park; this.areas.parks.forEach((p) => { path(p); g.fill(); });
    g.fillStyle = STYLE.water; g.strokeStyle = STYLE.waterEdge; g.lineWidth = 1; this.areas.water.forEach((p) => { path(p); g.fill(); g.stroke(); });
    if (s > 0.25) { g.fillStyle = STYLE.building; this.areas.buildings.forEach((p) => { path(p); g.fill(); }); }
    // roads: casing then fill, by class
    const wpx = (cls) => { const [, wm, minpx] = STYLE.road[cls] || STYLE.road.residential; return Math.max(minpx, wm * s); };
    const visible = this.roads.filter((r) => s > 0.05 || !["residential", "service"].includes(r.cls));
    g.lineCap = "round"; g.lineJoin = "round";
    visible.forEach((r) => { path(r.xy); g.strokeStyle = STYLE.casing; g.lineWidth = wpx(r.cls) + 2; g.stroke(); });
    visible.forEach((r) => { path(r.xy); g.strokeStyle = (STYLE.road[r.cls] || STYLE.road.residential)[0]; g.lineWidth = wpx(r.cls); g.stroke(); });
    // traffic (learned) + slow reports + blocked
    const ov = this.ov, traffic = ov.traffic || {}, slow = new Set(ov.slow || []), blocked = new Set(ov.blocked || []);
    visible.forEach((r) => {
      const f = traffic[r.i] || 1;
      if (blocked.has(r.name)) return;
      if (f >= 1.3 || slow.has(r.name)) { path(r.xy); g.strokeStyle = f >= 2 || slow.has(r.name) && f >= 2 ? STYLE.jam : STYLE.slow; g.lineWidth = Math.max(2.5, wpx(r.cls) * 0.55); g.setLineDash(slow.has(r.name) && f < 1.3 ? [6, 5] : []); g.stroke(); g.setLineDash([]); }
    });
    this.roads.forEach((r) => { if (!blocked.has(r.name)) return; path(r.xy); g.strokeStyle = "#ef4444"; g.lineWidth = Math.max(3, wpx(r.cls) * .7); g.setLineDash([7, 6]); g.stroke(); g.setLineDash([]); });
    // flood zones
    (ov.circles || []).forEach((c) => { const [x, y] = this.toScreen(...this.P(c.lat, c.lon)); g.beginPath(); g.arc(x, y, Math.max(6, c.r * s), 0, 7); g.fillStyle = "rgba(59,130,246,.22)"; g.fill(); g.strokeStyle = "rgba(147,197,253,.9)"; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); });
    // routes
    (ov.routes || []).forEach((rt) => {
      const xy = rt.coords.map((c) => this.P(c[0], c[1])); const w = rt.width || 6;
      path(xy); g.strokeStyle = rt.casing || STYLE.routeCasing; g.globalAlpha = rt.alpha ?? 1; g.lineWidth = w + 3; if (!rt.dash) g.stroke();
      path(xy); g.strokeStyle = rt.color || STYLE.route; g.lineWidth = w; g.setLineDash(rt.dash || []); g.stroke(); g.setLineDash([]);
      if (rt.flow) { path(xy); g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = w * .35; g.setLineDash([2, 22]); g.lineDashOffset = -t * 40; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; }
      g.globalAlpha = 1;
    });
    // road labels (major roads, avoid overlaps)
    const boxes = [];
    g.font = "600 11px Geist, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    this.labelCands.filter((r) => s > 0.12 || ["motorway", "trunk", "primary"].includes(r.cls)).forEach((r) => {
      const sp = r.xy.map((p) => this.toScreen(p[0], p[1])); let bi = 0, bl = 0;
      for (let i = 0; i < sp.length - 1; i++) { const l = Math.hypot(sp[i + 1][0] - sp[i][0], sp[i + 1][1] - sp[i][1]); if (l > bl) { bl = l; bi = i; } }
      const tw = g.measureText(r.name).width; if (bl < tw + 16) return;
      const a = sp[bi], b = sp[bi + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (mx < 0 || my < 0 || mx > this.w || my > this.h) return;
      const box = [mx - tw / 2 - 4, my - 9, mx + tw / 2 + 4, my + 9]; if (boxes.some((o) => !(box[2] < o[0] || box[0] > o[2] || box[3] < o[1] || box[1] > o[3]))) return; boxes.push(box);
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      g.save(); g.translate(mx, my); g.rotate(ang); g.lineWidth = 3.5; g.strokeStyle = STYLE.labelHalo; g.strokeText(r.name, 0, 0); g.fillStyle = STYLE.label; g.fillText(r.name, 0, 0); g.restore();
    });
    // blocked markers
    this.roads.forEach((r) => { if (!blocked.has(r.name) || r !== this.labelCands.find((x) => x.name === r.name)) return; const m = r.xy[Math.floor(r.xy.length / 2)], n = r.xy[Math.min(r.xy.length - 1, Math.floor(r.xy.length / 2) + 1)]; const [x, y] = this.toScreen((m[0] + n[0]) / 2, (m[1] + n[1]) / 2); badge(g, x, y, "⛔", "#7f1d1d"); });
    // markers
    this._markerHits = [];
    (ov.markers || []).forEach((m) => {
      const [x, y] = this.toScreen(...this.P(m.lat, m.lon)); if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) return;
      this._markerHits.push({ x, y, m });
      if (m.pulse) { const k = (t * 0.8 + (m.phase || 0)) % 1; g.beginPath(); g.arc(x, y, 8 + k * 22, 0, 7); g.strokeStyle = m.color; g.globalAlpha = 1 - k; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1; }
      drawMarker(g, x, y, m);
      if (m.label && (s > 0.08 || m.always)) { g.font = `${m.bold ? 700 : 600} 11px Geist, system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "top"; const ly = y + (m.kind === "pin" ? 6 : 14);
        g.lineWidth = 3.5; g.strokeStyle = STYLE.labelHalo; g.strokeText(m.label, x, ly); g.fillStyle = m.labelColor || "#e8eaf0"; g.fillText(m.label, x, ly);
        if (m.sub) { g.font = "500 10px 'Geist Mono', monospace"; g.strokeText(m.sub, x, ly + 13); g.fillStyle = "#a1a1aa"; g.fillText(m.sub, x, ly + 13); } }
    });
    // scale bar + attribution
    const mPer100 = 100 / s, nice = [50, 100, 200, 500, 1000, 2000, 5000].find((v) => v >= mPer100 * .6) || 5000, px = nice * s;
    g.fillStyle = "rgba(10,15,28,.7)"; g.fillRect(10, this.h - 26, px + 60, 18); g.strokeStyle = "#a1a1aa"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(16, this.h - 12); g.lineTo(16 + px, this.h - 12); g.stroke();
    g.font = "500 10px 'Geist Mono', monospace"; g.fillStyle = "#a1a1aa"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(nice >= 1000 ? nice / 1000 + " km" : nice + " m", 22 + px, this.h - 17);
    g.textAlign = "right"; g.fillText(this.geo.source === "osm" ? "© OpenStreetMap contributors" : "simplified road grid", this.w - 8, this.h - 10);
  }
}

function drawMarker(g, x, y, m) {
  const c = m.color || "#7dd3fc";
  if (m.kind === "pin") { // teardrop
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 12, y - 14, x - 10, y - 28, x, y - 28); g.bezierCurveTo(x + 10, y - 28, x + 12, y - 14, x, y);
    g.fillStyle = c; g.fill(); g.lineWidth = 2; g.strokeStyle = "#05070f"; g.stroke(); g.beginPath(); g.arc(x, y - 18, 4.5, 0, 7); g.fillStyle = "#fff"; g.fill(); return;
  }
  if (m.kind === "hospital") { rr(g, x - 11, y - 11, 22, 22, 6); g.fillStyle = m.closed ? "#52525b" : c; g.fill(); g.strokeStyle = "#05070f"; g.lineWidth = 2; g.stroke(); g.fillStyle = "#fff"; g.fillRect(x - 2.5, y - 7, 5, 14); g.fillRect(x - 7, y - 2.5, 14, 5); return; }
  if (m.kind === "pharmacy") { rr(g, x - 9, y - 9, 18, 18, 9); g.fillStyle = m.closed ? "#52525b" : "#f59e0b"; g.fill(); g.strokeStyle = "#05070f"; g.lineWidth = 2; g.stroke(); g.fillStyle = "#05070f"; g.font = "700 10px Geist, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Rx", x, y + .5); return; }
  if (m.kind === "ambulance") { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fillStyle = c; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.stroke(); g.fillStyle = "#05070f"; g.font = "11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("🚑", x, y + .5); return; }
  if (m.kind === "node") { g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = c; g.fillRect(-7, -7, 14, 14); g.strokeStyle = "#05070f"; g.lineWidth = 2; g.strokeRect(-7, -7, 14, 14); g.restore(); return; }
  if (m.kind === "me") { g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = "#3b82f6"; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); return; }
  g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = c; g.fill(); g.strokeStyle = "#05070f"; g.lineWidth = 2; g.stroke();
}
function badge(g, x, y, txt, bg) { g.beginPath(); g.arc(x, y, 10, 0, 7); g.fillStyle = bg; g.fill(); g.font = "12px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText(txt, x, y + 1); }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function len(xy) { let L = 0; for (let i = 1; i < xy.length; i++) L += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]); return L; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ---------- client-side routing (responder app rebuilds the route the base sent as road names)
export function routeLocal(geo, from, to, preferRoads = [], blocked = []) {
  const key = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  const nodes = new Map(), adj = new Map(), bl = new Set(blocked), pref = new Set(preferRoads);
  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  geo.roads.forEach((r) => {
    if (bl.has(r.name)) return;
    const a = key(r.g[0]), b = key(r.g[r.g.length - 1]); nodes.set(a, r.g[0]); nodes.set(b, r.g[r.g.length - 1]);
    let L = 0; for (let i = 1; i < r.g.length; i++) L += hv(r.g[i - 1], r.g[i]);
    const w = L * (pref.size ? (pref.has(r.name) ? 0.25 : 3) : 1);
    [[a, b, r.g], [b, a, [...r.g].reverse()]].forEach(([u, v, g]) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ v, w, g, name: r.name, L }); });
  });
  const near = (p) => { let best = null, bd = 1e18; nodes.forEach((q, k) => { const d = hv(p, q); if (d < bd) { bd = d; best = k; } }); return best; };
  const s = near(from), t = near(to); if (!s || !t) return null;
  const dist = new Map([[s, 0]]), prev = new Map(), done = new Set(), pq = [[0, s]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]); const [d, u] = pq.shift(); if (done.has(u)) continue; done.add(u); if (u === t) break;
    (adj.get(u) || []).forEach((e) => { const nd = d + e.w; if (nd < (dist.get(e.v) ?? 1e18)) { dist.set(e.v, nd); prev.set(e.v, { u, e }); pq.push([nd, e.v]); } });
  }
  if (!prev.has(t) && s !== t) return null;
  const segs = []; for (let v = t; v !== s; v = prev.get(v).u) segs.unshift(prev.get(v).e);
  const coords = [from, ...segs.flatMap((e) => e.g), to], steps = [];
  segs.forEach((e) => { const last = steps[steps.length - 1]; if (last && last.road === e.name) last.dist += e.L; else steps.push({ road: e.name, dist: e.L }); });
  return { coords, steps: steps.map((x) => ({ ...x, dist: Math.round(x.dist) })) };
}
