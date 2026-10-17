// FreightStruck-style aerial hero for MedMesh: real 3D (three.js) holographic wireframes over a dotted ground,
// LoRa arcs with travelling packets, an ambulance driving the roads, a step card that walks through the flow.
import {
  Scene, PerspectiveCamera, WebGLRenderer, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, Fog, Group,
  BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry, QuadraticBezierCurve3,
  Vector3, Line, AdditiveBlending, DoubleSide, CanvasTexture, SpriteMaterial, Sprite,
} from "three";

const SKY = 0x7dd3fc, BLUE = 0x3b82f6, GREEN = 0x34d399, RED = 0xf43f5e, VIOLET = 0xa78bfa, PINK = 0xf472b6;

function glowTex(rgb) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, `rgba(${rgb},1)`); r.addColorStop(0.25, `rgba(${rgb},.55)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
const lineMat = (color, opacity = 0.9) => new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const fillMat = (color, opacity = 0.1) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });

// box with a grid drawn on its side faces (floors + mullions) = the "detailed hologram" look
function gridBox(w, h, d, nx, ny, nz, color = SKY, fill = BLUE) {
  const g = new Group(), v = [], x0 = -w / 2, z0 = -d / 2;
  const seg = (a, b) => v.push(...a, ...b);
  for (let j = 0; j <= ny; j++) { const y = (h * j) / ny; seg([x0, y, z0], [-x0, y, z0]); seg([-x0, y, z0], [-x0, y, -z0]); seg([-x0, y, -z0], [x0, y, -z0]); seg([x0, y, -z0], [x0, y, z0]); }
  for (let i = 0; i <= nx; i++) { const x = x0 + (w * i) / nx; seg([x, 0, z0], [x, h, z0]); seg([x, 0, -z0], [x, h, -z0]); }
  for (let k = 0; k <= nz; k++) { const z = z0 + (d * k) / nz; seg([x0, 0, z], [x0, h, z]); seg([-x0, 0, z], [-x0, h, z]); }
  const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(v, 3));
  g.add(new LineSegments(geo, lineMat(color, 0.75)));
  const m = new Mesh(new BoxGeometry(w, h, d), fillMat(fill, 0.13)); m.position.y = h / 2; g.add(m);
  return g;
}
// lattice radio mast
function mast(h = 3.2, color = SKY) {
  const v = [], b = 0.32, t = 0.06, n = 6;
  const P = (s, y) => { const r = b + (t - b) * (y / h); return [[-r, y, -r], [r, y, -r], [r, y, r], [-r, y, r]][s]; };
  for (let s = 0; s < 4; s++) v.push(...P(s, 0), ...P(s, h));
  for (let i = 0; i < n; i++) {
    const y1 = (h * i) / n, y2 = (h * (i + 1)) / n;
    for (let s = 0; s < 4; s++) { const a = P(s, y1), c = P((s + 1) % 4, y2), d = P((s + 1) % 4, y1); v.push(...a, ...c, ...a, ...d); }
  }
  const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(v, 3));
  return new LineSegments(geo, lineMat(color, 0.8));
}

export function aerial3d(root, opts = {}) {
  const canvas = root.querySelector("canvas"), lblBox = root.querySelector(".a3lbls"), card = root.querySelector(".a3card");
  let W = 0, H = 0, alive = true, raf = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { root.classList.add("nogl"); return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new Scene(); scene.fog = new Fog(0x05070f, 24, 60);
  const cam = new PerspectiveCamera(38, 1, 0.1, 200);

  // dotted ground
  const pts = []; for (let x = -24; x <= 24; x += 0.6) for (let z = -24; z <= 24; z += 0.6) pts.push(x, 0, z);
  const pg = new BufferGeometry(); pg.setAttribute("position", new Float32BufferAttribute(pts, 3));
  scene.add(new Points(pg, new PointsMaterial({ color: 0x94a3b8, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false })));

  // faint road grid (Scarborough-ish arterials)
  const roads = [];
  [-6, -1, 4, 9].forEach((z) => roads.push(-16, 0.01, z, 16, 0.01, z));
  [-8, -3, 2, 7].forEach((x) => roads.push(x, 0.01, -14, x, 0.01, 14));
  const rg = new BufferGeometry(); rg.setAttribute("position", new Float32BufferAttribute(roads, 3));
  scene.add(new LineSegments(rg, lineMat(BLUE, 0.16)));

  // nodes
  const N = {
    FIELD: { p: new Vector3(-7, 0, 5), label: "FIELD · SENIORS' HOME", kind: "home" },
    RELAY: { p: new Vector3(-1.5, 0, -0.5), label: "RELAY", kind: "mast" },
    RESP: { p: new Vector3(1.8, 0, 6.5), label: "RESP · AMBULANCE", kind: "mast" },
    BASE: { p: new Vector3(5.5, 0, -5), label: "BASE · COMMAND CENTRE", kind: "base" },
    HOSP: { p: new Vector3(9.5, 0, 3.5), label: "CENTENARY HOSPITAL", kind: "hosp" },
  };
  const glowB = glowTex("125,211,252"), glowG = glowTex("52,211,153"), glowR = glowTex("244,63,94");
  const rings = [];
  const addRing = (p, color, r = 1.2) => {
    const m = new Mesh(new RingGeometry(r * 0.92, r, 48), fillMat(color, 0.5)); m.rotation.x = -Math.PI / 2; m.position.copy(p).setY(0.02); scene.add(m);
    const pulse = new Mesh(new RingGeometry(0.9, 1, 48), fillMat(color, 0.6)); pulse.rotation.x = -Math.PI / 2; pulse.position.copy(p).setY(0.03); scene.add(pulse);
    rings.push({ pulse, r, phase: Math.random() });
  };
  const sprite = (tex, s, p) => { const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending })); sp.scale.set(s, s, 1); sp.position.copy(p); scene.add(sp); return sp; };
  Object.entries(N).forEach(([k, n]) => {
    const g = new Group(); g.position.copy(n.p);
    if (n.kind === "mast") { g.add(mast()); n.top = 3.3; addRing(n.p, BLUE, 1.1); }
    if (n.kind === "home") { const b = gridBox(2.6, 1.4, 1.8, 6, 3, 4, SKY, BLUE); g.add(b); const m = mast(1.4); m.position.set(0.7, 1.4, 0); g.add(m); n.top = 2.9; addRing(n.p, RED, 2.0); }
    if (n.kind === "base") { g.add(gridBox(2.2, 1.0, 2.2, 5, 2, 5, GREEN, GREEN)); const m = mast(2.6, 0x6ee7b7); m.position.y = 1.0; g.add(m); n.top = 3.7; addRing(n.p, GREEN, 1.8); }
    if (n.kind === "hosp") {
      const a = gridBox(3.2, 3.0, 2.0, 8, 6, 5); g.add(a);
      const wing = gridBox(1.6, 1.8, 3.4, 4, 4, 8); wing.position.set(-2.2, 0, 0.6); g.add(wing);
      const cr = new Group(); cr.add(new LineSegments(new EdgesGeometry(new BoxGeometry(0.9, 0.08, 0.28)), lineMat(RED, 1)), new LineSegments(new EdgesGeometry(new BoxGeometry(0.28, 0.08, 0.9)), lineMat(RED, 1)));
      cr.add(new Mesh(new BoxGeometry(0.9, 0.08, 0.28), fillMat(RED, 0.5)), new Mesh(new BoxGeometry(0.28, 0.08, 0.9), fillMat(RED, 0.5)));
      cr.position.y = 3.1; g.add(cr); n.top = 3.6; addRing(n.p, BLUE, 2.4);
    }
    scene.add(g); n.group = g;
    n.glow = sprite(k === "BASE" ? glowG : k === "FIELD" ? glowR : glowB, k === "FIELD" ? 1.6 : 1.2, n.p.clone().setY(n.top));
    const el = document.createElement("div"); el.className = "a3lbl" + (k === "FIELD" ? " sos" : k === "BASE" ? " base" : ""); el.textContent = root.clientWidth < 500 ? ({ FIELD: "FIELD · HOME", RESP: "RESP", BASE: "BASE", HOSP: "HOSPITAL", RELAY: "RELAY" })[k] : n.label; lblBox.appendChild(el); n.el = el;
  });

  // LoRa arcs
  const arc = (a, b, color, h = 3.2) => {
    const A = N[a].p.clone().setY(N[a].top), B = N[b].p.clone().setY(N[b].top);
    const M = A.clone().add(B).multiplyScalar(0.5); M.y += h;
    const curve = new QuadraticBezierCurve3(A, M, B), pts = curve.getPoints(64);
    const geo = new BufferGeometry().setFromPoints(pts), line = new Line(geo, lineMat(color, 0.25)); scene.add(line);
    const pk = sprite(glowB, 0.7, A);
    return { a, b, curve, line, geo, pk, t: Math.random(), draw: 65, color };
  };
  const L = {
    fr: arc("FIELD", "RELAY", SKY), rb: arc("RELAY", "BASE", SKY), fs: arc("FIELD", "RESP", VIOLET, 2), sb: arc("RESP", "BASE", PINK),
    bh: arc("BASE", "HOSP", GREEN, 2.4), bs: arc("BASE", "RESP", 0xfbbf24, 4),
  };

  // ambulance driving the grid: RESP -> FIELD -> HOSP
  const amb = new Group();
  const ab = new BoxGeometry(0.9, 0.45, 0.45); amb.add(new LineSegments(new EdgesGeometry(ab), lineMat(0xe0f2fe, 1)), new Mesh(ab, fillMat(SKY, 0.35)));
  amb.children.forEach((c) => (c.position.y = 0.25));
  const siren = sprite(glowR, 0.8, new Vector3()); scene.add(amb);
  const route = [[2, 6.5], [2, 9], [-7, 9], [-7, 5], [-7, 9], [7, 9], [7, 4], [9.5, 4]].map(([x, z]) => new Vector3(x, 0, z));
  const segLen = route.slice(1).map((p, i) => p.distanceTo(route[i])), total = segLen.reduce((a, b) => a + b, 0);
  const along = (d) => { d %= total; for (let i = 0; i < segLen.length; i++) { if (d <= segLen[i]) { const p = route[i].clone().lerp(route[i + 1], d / segLen[i]); const dir = route[i + 1].clone().sub(route[i]); return { p, yaw: Math.atan2(-dir.z, dir.x) }; } d -= segLen[i]; } return { p: route[0], yaw: 0 }; };

  // story steps
  const STEPS = [
    ["01", "SOS", "A resident holds SOS. 60 bytes leave the phone over Bluetooth to the FIELD node.", ["fr", "fs"], "FIELD"],
    ["02", "Mesh hop", "LoRa carries it hop by hop. If RELAY is flooded, RESP takes over automatically.", ["fr", "rb", "fs", "sb"], "RELAY"],
    ["03", "Dispatch", "Command centre scores hospitals, routes the ambulance around closed roads.", ["bh", "bs"], "BASE"],
  ];
  let step = -1, stepAt = 0;
  const setStep = (i) => {
    step = i; stepAt = performance.now();
    const [n, t, d, links] = STEPS[i];
    if (card) { card.innerHTML = `<span class="a3n">${n}</span><div><b>${t}</b><p>${d}</p></div><div class="a3dots">${STEPS.map((_, j) => `<i data-a3="${j}" class="${j === i ? "on" : ""}"></i>`).join("")}</div>`; card.classList.remove("swap"); void card.offsetWidth; card.classList.add("swap");
      card.querySelectorAll("[data-a3]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); setStep(Number(el.dataset.a3)); })); }
    Object.entries(L).forEach(([k, l]) => { l.on = links.includes(k); if (l.on) l.draw = 0; });
  };
  setStep(0);

  // camera orbit + drag
  let yaw = 0.55, drag = null, vel = 0;
  const onDown = (e) => { drag = e.clientX; vel = 0; root.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (drag == null) return; const dx = (e.clientX - drag) / 180; yaw -= dx; vel = -dx; drag = e.clientX; };
  const onUp = () => { drag = null; };
  canvas.addEventListener("pointerdown", onDown); window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);

  const resize = () => { const r = root.getBoundingClientRect(); W = r.width; H = r.height; renderer.setSize(W, H, false); cam.aspect = W / H; cam.fov = W < 500 ? 46 : 38; cam.setViewOffset(W, H, 0, H * 0.07, W, H); cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  const tmp = new Vector3(), t0 = performance.now();
  function frame(now) {
    if (!alive) return;
    const t = (now - t0) / 1000;
    if (drag == null) { yaw += vel; vel *= 0.94; if (!reduce) yaw += 0.0009; }
    const narrow = W < 500, R = narrow ? 25.5 : 25, target = new Vector3(1.6, narrow ? 1.6 : 0, 1.4);
    cam.position.set(target.x + Math.sin(yaw) * R, narrow ? 17.5 : 15.5, target.z + Math.cos(yaw) * R); cam.lookAt(target);
    if (!opts.manual && now - stepAt > 5200) setStep((step + 1) % STEPS.length);
    // arcs: draw-on + packets
    Object.values(L).forEach((l) => {
      l.line.material.opacity += ((l.on ? 0.95 : 0.16) - l.line.material.opacity) * 0.08;
      if (l.on && l.draw < 65) l.draw = Math.min(65, l.draw + 1.6);
      l.geo.setDrawRange(0, l.on ? Math.floor(l.draw) : 65);
      l.t = (l.t + (l.on ? 0.009 : 0.003)) % 1; l.pk.position.copy(l.curve.getPoint(l.t));
      l.pk.material.opacity = l.on ? 1 : 0.25; l.pk.scale.setScalar(l.on ? 0.8 : 0.45);
    });
    rings.forEach((r) => { const k = (t * 0.45 + r.phase) % 1; r.pulse.scale.setScalar(r.r * (0.6 + k * 1.2)); r.pulse.material.opacity = 0.55 * (1 - k); });
    N.FIELD.glow.scale.setScalar(1.3 + Math.sin(t * 5) * 0.35);
    const a = along(t * 2.2); amb.position.copy(a.p); amb.rotation.y = a.yaw; siren.position.copy(a.p).setY(0.75); siren.material.opacity = Math.sin(t * 14) > 0 ? 1 : 0.2;
    // labels
    Object.values(N).forEach((n) => {
      tmp.copy(n.p).setY(n.top + 0.55).project(cam);
      const hw = (n.el.offsetWidth || 60) / 2 + 4, x = Math.max(hw, Math.min(W - hw, (tmp.x * 0.5 + 0.5) * W)), y = (-tmp.y * 0.5 + 0.5) * H;
      n.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      n.el.classList.toggle("hot", STEPS[step][4] === Object.keys(N).find((k) => N[k] === n));
    });
    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (alive) raf = requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", vis);

  return () => {
    alive = false; cancelAnimationFrame(raf); ro.disconnect();
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); document.removeEventListener("visibilitychange", vis);
    scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    renderer.dispose();
  };
}
