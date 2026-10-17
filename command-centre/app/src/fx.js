// Aerial mesh hero: a tilted city grid seen from above, radio nodes with light beams, packets hopping between them.
export function aerial(canvas) {
  const g = canvas.getContext("2d");
  let w = 0, h = 0, raf = 0, t0 = performance.now(), alive = true;
  const nodes = [
    { x: -1.6, z: 2.6, name: "FIELD" }, { x: 0.3, z: 4.6, name: "RELAY" }, { x: 1.9, z: 3.0, name: "RESP" },
    { x: 0.6, z: 7.5, name: "BASE", base: true }, { x: -2.6, z: 6.2, name: "" }, { x: 2.9, z: 6.0, name: "" },
  ];
  const links = [[0, 1], [1, 3], [0, 2], [2, 3], [4, 1], [5, 3], [4, 3]];
  const packets = links.map((l, i) => ({ l, p: (i * 0.37) % 1, s: 0.22 + (i % 3) * 0.07 }));
  const resize = () => {
    const r = canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height; canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // perspective projection of ground point (x, z) at height y
  const P = (x, z, y = 0) => { const f = h * 0.95, cz = z + 1.2; return [w / 2 + (x * f) / cz / 1.4, h * 0.12 + (f * 1.1 - y * f * 0.35) / cz]; };
  function frame(now) {
    if (!alive) return;
    const t = (now - t0) / 1000;
    g.clearRect(0, 0, w, h);
    // grid (city blocks) drifting slowly toward the viewer
    const drift = reduce ? 0 : (t * 0.35) % 1;
    g.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      const z = i - drift + 0.2; if (z < 0.1) continue;
      const a = Math.max(0, 0.16 - z * 0.006);
      g.strokeStyle = `rgba(125,211,252,${a})`;
      const [x1, y1] = P(-9, z), [x2, y2] = P(9, z); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    for (let x = -9; x <= 9; x += 1.5) {
      const [x1, y1] = P(x, 0.2), [x2, y2] = P(x, 22);
      const gr = g.createLinearGradient(x1, y1, x2, y2); gr.addColorStop(0, "rgba(125,211,252,.14)"); gr.addColorStop(1, "rgba(125,211,252,0)");
      g.strokeStyle = gr; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    // links (arcs in the air)
    const arc = (a, b, k) => { const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = 0.9 + Math.sin(Math.PI * k) * 0.9; return P(x, z, y); };
    links.forEach(([i, j]) => {
      g.beginPath(); for (let k = 0; k <= 1.0001; k += 0.05) { const [x, y] = arc(nodes[i], nodes[j], k); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = "rgba(56,189,248,.28)"; g.lineWidth = 1.2; g.stroke();
    });
    // beams + nodes
    nodes.forEach((n, i) => {
      const [bx, by] = P(n.x, n.z, 0), [tx, ty] = P(n.x, n.z, 0.9);
      const gr = g.createLinearGradient(bx, by, tx, ty); gr.addColorStop(0, "rgba(56,189,248,0)"); gr.addColorStop(1, n.base ? "rgba(52,211,153,.55)" : "rgba(56,189,248,.55)");
      g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
      const pulse = reduce ? 0.5 : (Math.sin(t * 2 + i) + 1) / 2;
      g.fillStyle = n.base ? `rgba(52,211,153,${0.12 + pulse * 0.12})` : `rgba(56,189,248,${0.1 + pulse * 0.12})`;
      g.beginPath(); g.ellipse(bx, by, 16 + pulse * 6, (16 + pulse * 6) * 0.35, 0, 0, 7); g.fill();
      g.fillStyle = n.base ? "#34d399" : "#7dd3fc"; g.shadowColor = g.fillStyle; g.shadowBlur = 14;
      g.beginPath(); g.arc(tx, ty, n.base ? 4.5 : 3.5, 0, 7); g.fill(); g.shadowBlur = 0;
      if (n.name) { g.font = "600 9px 'Geist Mono', ui-monospace, monospace"; g.fillStyle = "rgba(226,232,240,.55)"; g.textAlign = "center"; g.fillText(n.name, tx, ty - 9); }
    });
    // packets
    packets.forEach((pk) => {
      if (!reduce) pk.p = (pk.p + pk.s / 60) % 1;
      const [x, y] = arc(nodes[pk.l[0]], nodes[pk.l[1]], pk.p);
      g.fillStyle = "#e0f2fe"; g.shadowColor = "#38bdf8"; g.shadowBlur = 12; g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); g.shadowBlur = 0;
    });
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
}

// Small animated mesh diagram used on home screens: you -> node -> ... -> command centre
export function meshStrip(path, ok) {
  const names = ["You", ...path];
  const n = names.length, W = 300, step = W / (n - 1 || 1);
  const xs = names.map((_, i) => 14 + i * ((W - 28) / (n - 1 || 1)));
  const lines = xs.slice(1).map((x, i) => `<line x1="${xs[i]}" y1="22" x2="${x}" y2="22" class="ml ${ok ? "on" : ""} ${i === 0 ? "bt" : ""}"/>`).join("");
  const dots = names.map((nm, i) => `<g class="mn ${ok ? "on" : ""} ${i === n - 1 ? "base" : ""} ${i === 0 ? "me" : ""}"><circle cx="${xs[i]}" cy="22" r="${i === 0 || i === n - 1 ? 7 : 5.5}"/><text x="${xs[i]}" y="46">${nm}</text></g>`).join("");
  const pkt = ok ? `<circle r="3" class="mp"><animateMotion dur="${0.9 * (n - 1)}s" repeatCount="indefinite" path="M${xs[0]},22 L${xs[n - 1]},22"/></circle>` : "";
  void step;
  return `<svg class="meshstrip" viewBox="0 0 ${W} 54" preserveAspectRatio="xMidYMid meet">${lines}${pkt}${dots}</svg>`;
}
