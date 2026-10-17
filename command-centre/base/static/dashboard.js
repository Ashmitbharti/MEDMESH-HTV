/* MedMesh Command Centre dashboard */
(() => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TRI = { 1: "IMMEDIATE", 2: "DELAYED", 3: "MINOR", 4: "EXPECTANT" };
const CMP = { CP: "Chest pain", BR: "Breathing difficulty", BL: "Bleeding / injury", BU: "Burn", UN: "Unconscious", PR: "Pregnancy", FX: "Fracture / fall", OT: "Other" };
const AGE = { C: "Child", A: "Adult", S: "Senior" };
const CAPS = { C: "Cardiac", T: "Trauma", B: "Burns", O: "Obstetrics", P: "Paeds" };
const MED = { INSULIN: "Insulin", INHALER: "Inhaler", EPIPEN: "EpiPen", HEART: "Heart meds", SEIZURE: "Seizure meds", BP: "BP meds", ONEG: "O-neg blood" };
const STATUS = { new: "new", dispatched: "dispatched", en_route: "en route", picked_up: "picked up", delivered: "delivered", no_route: "NO ROUTE" };
let S = null, MAP = null, STREET = null, GEO = null, sel = null, lastLog = -1, seenCases = new Set();

const api = (p, body) => fetch(p, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString("en-CA", { hour12: false })), 1000);

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 4200); }

/* ---------------------------------------------------------------- websocket */
function connect() {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") { S = m.state; render(); } };
  ws.onclose = () => { poll(); setTimeout(connect, 3000); };
}
// fallback if WebSockets are unavailable: poll the state
function poll() { api("/api/state").then((s) => { S = s; render(); }).catch(() => {}); }

/* ---------------------------------------------------------------- render */
function render() {
  const nodes = Object.values(S.nodes || {});
  const on = nodes.filter((n) => n.online).length;
  $("#modeBadge").innerHTML = `<span class="dot ${S.mode === "sim" ? "warn" : ""}"></span>${S.mode === "sim" ? "Simulator" : "Live mesh"}`;
  $("#netBadge").innerHTML = `<span class="dot ${on < nodes.length ? "off" : ""}"></span>${on}/${nodes.length} nodes online`;
  $("#aiBadge").innerHTML = `<span class="dot ${S.ai ? "" : "warn"}"></span>${S.ai ? "Offline AI ready" : "AI: template mode"}`;
  $("#blockedBadge").textContent = `${S.blocked.length} road${S.blocked.length === 1 ? "" : "s"} blocked · ${S.floods.length} flood zone${S.floods.length === 1 ? "" : "s"}`;
  renderCases(); renderDetail(); renderHospitals(); renderPharmacies(); renderRequests(); renderNodes(); renderLog(); renderSummary();
  if (MAP && $("#map").style.display !== "none") MAP.update(S, sel);
  updateStreet(); renderTraffic(); renderComms();
}
function renderComms() {
  const L = { WARN: "⚠️", INFO: "ℹ️", EVAC: "🚨" };
  $("#alerts").innerHTML = (S.alerts || []).slice().reverse().map((a) => `${a.t} ${L[a.level] || ""} ${esc(a.text)}`).join("<br>") || `<span class="hint">No alerts sent yet.</span>`;
  const ci = (S.checkins || []).slice().reverse();
  $("#ciCount").textContent = ci.filter((c) => c.status === "SAFE").length + " safe · " + ci.filter((c) => c.status !== "SAFE").length + " need help";
  $("#checkins").innerHTML = ci.map((c) => `${c.t} ${c.status === "SAFE" ? "✅" : "🟠"} <b>${esc(c.name)}</b> ${c.status === "SAFE" ? "is safe" : "needs help (not urgent)"} <span style="color:var(--dim)">via ${esc(c.via)}${c.hops != null ? " · " + c.hops + " hops" : ""}</span>`).join("<br>") || `<span class="hint">"I'm safe" and non-urgent help check-ins from the community appear here.</span>`;
}

/* ---------------------------------------------------------------- street map overlay */
const TRICOL = { 1: "#ef4444", 2: "#fbbf24", 3: "#34d399", 4: "#71717a" };
let lastFitSel = null;
function updateStreet() {
  if (!STREET) return;
  const routes = [], markers = [];
  Object.values(S.cases).forEach((c) => {
    if (c.status === "delivered") return;
    const isSel = c.id === sel;
    if (c.pickup_route && c.status === "dispatched") routes.push({ coords: c.pickup_route.coords, color: "#38bdf8", width: isSel ? 4 : 3, dash: [8, 6], alpha: isSel ? 1 : .55 });
    if (c.route) routes.push({ coords: c.route.coords, color: "#3b82f6", width: isSel ? 7 : 4, alpha: isSel ? 1 : .5, flow: isSel });
    markers.push({ kind: "pin", lat: c.loc[0], lon: c.loc[1], color: TRICOL[c.triage], label: (CMP[c.complaint] || c.complaint), sub: c.id, pulse: c.triage === 1, phase: Math.random(), id: c.id, bold: isSel, always: isSel });
  });
  S.hospitals.forEach((h) => markers.push({ kind: "hospital", lat: h.lat, lon: h.lon, color: "#2563eb", closed: !h.open, label: h.name, sub: h.open ? `${h.free} beds · ${h.caps || "minor"}` : "CLOSED", always: true, labelColor: S.cases[sel]?.hospital === h.id ? "#34d399" : "#e8eaf0" }));
  S.pharmacies.forEach((p) => markers.push({ kind: "pharmacy", lat: p.lat, lon: p.lon, closed: !p.open, label: p.name }));
  markers.push({ kind: "dot", lat: S.ems.lat, lon: S.ems.lon, color: "#38bdf8", label: "EMS post" });
  Object.values(S.nodes || {}).forEach((n) => { const ll = S.layout[(n.name || "").toUpperCase()]; if (ll) markers.push({ kind: "node", lat: ll[0], lon: ll[1], color: n.online ? "#818cf8" : "#ef4444", label: "◆ " + n.name, sub: n.online ? "mesh node" : "OFFLINE" }); });
  Object.values(S.ambulances || {}).forEach((a) => a.lat && markers.push({ kind: "ambulance", lat: a.lat, lon: a.lon, color: "#34d399", label: a.kmh != null ? `${a.kmh} km/h` : "", sub: a.road || "", always: true }));
  (S.checkins || []).forEach((c) => c.loc && markers.push({ kind: "dot", lat: c.loc[0], lon: c.loc[1], color: c.status === "SAFE" ? "#34d399" : "#f59e0b", label: (c.status === "SAFE" ? "✓ " : "! ") + c.name }));
  const traffic = {}; (S.traffic || []).forEach((t) => (traffic[t.i] = t.f));
  STREET.setOverlay({ routes, markers, traffic, slow: Object.keys(S.slow || {}), blocked: S.blocked, circles: S.floods });
  if (sel && sel !== lastFitSel && S.cases[sel]?.route) { lastFitSel = sel; const c = S.cases[sel]; STREET.fit([...(c.pickup_route?.coords || []), ...c.route.coords]); }
}
function renderTraffic() {
  const slow = Object.entries(S.slow || {}).map(([r, v]) => `🐢 <b>${esc(r)}</b> ×${v.factor} slow · ${esc(v.reason)} · ${esc(v.by)} ${v.t}`);
  const jams = Object.entries(S.sim_traffic || {}).map(([r, f]) => `<span style="color:var(--dim)">(sim truth) hidden jam on ${esc(r)}: cars at 1/${f} speed</span>`);
  const learned = (S.traffic || []).length ? [`📡 ${S.traffic.length} road segment${S.traffic.length === 1 ? "" : "s"} slowed by live ambulance speeds`] : [];
  const ev = (S.traffic_events || []).slice().reverse().map((e) => "🚑 " + esc(e));
  $("#traffic").innerHTML = [...slow, ...learned, ...ev, ...jams].join("<br>") || `<span class="hint">No congestion reported. Ambulances report GPS over the mesh; when one moves slower than the speed limit, that road gets a congestion factor and routes adapt.</span>`;
}

function caseList() {
  const order = { new: 0, no_route: 0, dispatched: 1, en_route: 1, picked_up: 2, delivered: 3 };
  return Object.values(S.cases).sort((a, b) => (order[a.status] - order[b.status]) || (a.triage - b.triage) || (b.ts - a.ts));
}

function renderCases() {
  const list = caseList();
  $("#caseCount").textContent = list.filter((c) => c.status !== "delivered").length + " active";
  if (!list.length) { $("#cases").innerHTML = `<div class="empty">Waiting for reports from the mesh…</div>`; return; }
  if (!sel || !S.cases[sel]) sel = list[0].id;
  $("#cases").innerHTML = list.map((c) => {
    const fresh = !seenCases.has(c.id); seenCases.add(c.id);
    if (fresh && c.triage === 1) toast(`🔴 IMMEDIATE: ${CMP[c.complaint] || c.complaint} reported via ${c.from} (${c.hops ?? "?"} hops)`);
    return `<div class="case ${c.id === sel ? "sel" : ""} ${fresh && c.triage === 1 ? "new" : ""}" data-id="${c.id}">
      <span class="bar t${c.triage}"></span>
      <div><h3>${esc(CMP[c.complaint] || c.complaint)}${c.profile ? ` · ${esc(c.profile.name)}` : ""}</h3>
        <div class="meta">${AGE[c.age] || ""} · ${c.count} hurt · ${c.time} · ${c.hops ?? "?"} hop${c.hops === 1 ? "" : "s"}</div>
        <div class="meta" style="margin-top:3px">${c.hospital ? `→ <b style="color:var(--ink)">${esc(c.hospital_name)}</b> · ${c.pickup_eta ?? "?"}+${c.eta} min` : "assigning…"}</div></div>
      <div style="text-align:right"><span class="tri t${c.triage}">${TRI[c.triage]}</span><div class="meta" style="margin-top:6px">${STATUS[c.status] || c.status}</div></div></div>`;
  }).join("");
  document.querySelectorAll(".case").forEach((el) => (el.onclick = () => { sel = el.dataset.id; render(); }));
}

function renderDetail() {
  const c = S.cases[sel];
  if (!c) { $("#detTri").innerHTML = ""; $("#detail").innerHTML = `<div class="empty">Select a case to see the handoff note, red flags and hospital choice.</div>`; return; }
  $("#detTri").innerHTML = `<span class="tri t${c.triage}">${TRI[c.triage]}</span>`;
  const p = c.profile, sb = c.sbar;
  const flags = (c.flags || []).map((f, i) => `<div class="flag ${f.ack ? "ack" : ""}" data-i="${i}"><span class="box">${f.ack ? "✓" : ""}</span><div>${esc(f.flag)}<small>because: ${esc(f.why)}</small></div></div>`).join("");
  const acked = (c.flags || []).filter((f) => f.ack).length;
  const D = c.decision;
  const fmtBeds = (r) => r.beds == null ? "–" : r.beds_source === "reported" ? `${Math.round(r.beds)}` : `${r.beds.toFixed(1)}<small style="color:var(--dim)"> ±${r.beds_sd.toFixed(1)} est</small>`;
  const fmtWait = (w) => w == null ? "–" : w >= 600 ? `<span style="color:var(--red)">overloaded</span>` : `${Math.round(w)}`;
  const opts = D ? D.candidates.map((r) => `<tr class="${r.id === c.hospital ? "win" : ""}" style="${r.eligible ? "" : "opacity:.5"}"><td>${esc(r.name)}<small style="color:var(--dim)"> ${r.kind === "clinic" ? "clinic" : esc(r.caps || "")}</small></td>
      <td class="mono">${r.drive_min == null ? "–" : Math.round(r.drive_min)}</td><td class="mono">${fmtWait(r.wait_min)}</td><td class="mono">${fmtBeds(r)}</td>
      <td class="mono">${r.p_no_bed > 0.01 ? Math.round(r.p_no_bed * 100) + "%" : "–"}</td><td class="mono"><b>${r.time_to_treatment == null ? "–" : Math.round(r.time_to_treatment)}</b></td>
      <td class="mono">${r.eligible && r.outcome_loss != null ? r.outcome_loss.toFixed(2) : "✕"}</td><td style="color:var(--dim)">${esc(r.why_out.join(", "))}</td></tr>`).join("")
    : (c.options || []).map((o) => `<tr class="${o.id === c.hospital ? "win" : ""}"><td>${esc(o.name)}</td><td class="mono">${o.eta ?? "–"}</td><td colspan="5" style="color:var(--dim)">${o.ok && o.cap_ok ? esc(o.breakdown || "") : esc(o.why.join(", "))}</td><td></td></tr>`).join("");
  $("#detail").innerHTML = `
    <dl class="kv">
      <dt>Complaint</dt><dd><b>${esc(CMP[c.complaint] || c.complaint)}</b> · ${AGE[c.age] || ""} · ${c.count} hurt</dd>
      <dt>Answers</dt><dd>${c.walk ? "walks" : "can't walk"} · breathing ${c.breathing} · ${c.responds ? "responds" : "NOT responding"}${c.bleeding ? " · heavy bleeding" : ""}</dd>
      <dt>Received</dt><dd>${c.time} from ${esc(c.from)} · ${c.hops ?? "?"} hops${c.path ? ` <span class="mono" style="color:var(--violet)">${c.path.join(" → ")}</span>` : ""}</dd>
      <dt>Medical ID</dt><dd>${p ? `<span class="mono" style="color:var(--sky)">${esc(c.mid)}</span> · <b>${esc(p.name)}</b>, ${p.age}${p.sex} · 🩸 <b>${esc(p.blood)}</b>` : c.mid_unknown ? `<span style="color:var(--yel)">${esc(c.mid)} not found</span>` : `<span style="color:var(--dim)">none</span>`}</dd>
      ${p ? `<dt>Allergies</dt><dd style="color:${p.allergies.length ? "#fca5a5" : "inherit"}">${esc(p.allergies.join(", ") || "none known")}</dd><dt>History</dt><dd>${esc(p.conditions.join(", "))} · meds: ${esc(p.meds.join(", "))}</dd><dt>Contact</dt><dd>${esc(p.contact)} <span style="color:var(--dim)">(updated ${esc(p.updated)})</span></dd>` : ""}
      ${Object.keys(c.extras || {}).length ? `<dt>Bystander</dt><dd>${Object.entries(c.extras).map(([k, v]) => `${k}: ${esc(v)}`).join(" · ")}</dd>` : ""}
    </dl>
    <div class="eyebrow" style="margin:16px 0 8px">Handoff note (SBAR)</div>
    ${sb ? `<div class="sbar"><b>S</b><span>${esc(sb.S)}</span><b>B</b><span>${esc(sb.B)}</span><b>A</b><span>${esc(sb.A)}</span><b>R</b><span>${esc(sb.R)}</span></div>
      <div class="ai-note">${sb.by === "template" ? "Template (start Ollama for AI wording)" : "Written by offline AI (" + esc(sb.by) + ")"} · AI suggestion, not a diagnosis</div>` : `<div class="hint">Writing note…</div>`}
    <div class="eyebrow" style="margin:16px 0 8px">Red flags · ${acked}/${(c.flags || []).length} reviewed</div>
    ${flags || `<div class="hint">None.</div>`}
    ${(c.prepare || []).length ? `<div class="eyebrow" style="margin:14px 0 6px">Hospital should prepare</div><div class="meta">${c.prepare.map(esc).join(" · ")}</div>` : ""}
    <div class="eyebrow" style="margin:16px 0 4px">Dispatch decision${c.relaxed ? ` <span style="color:var(--yel)">· capability relaxed</span>` : ""}</div>
    ${D ? `<div class="hint" style="margin-bottom:6px">Evaluated <b>${D.evaluated}</b> facilities · ${D.eliminated} eliminated · ${D.compute_ms} ms · unit ${esc(D.unit || "on board")}${D.pickup_min ? ` (${Math.round(D.pickup_min)} min to patient)` : ""} · time window τ ${Math.round(D.profile.tau)} min</div>
      <ul class="explain" style="margin:0 0 8px 16px;padding:0">${D.explain.filter((l) => !l.startsWith("Evaluated")).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    <div class="hint" style="margin-bottom:4px">Ranked by time to treatment = ambulance + scene + drive + queue wait for this triage level (Erlang-C priority model) + bed risk. Harm = weight × (1 − e<sup>−t/τ</sup>). Lower wins.</div>
    <div style="overflow-x:auto"><table><tr><th>Facility</th><th>Drive</th><th>Wait</th><th>Beds</th><th>No-bed risk</th><th>To treatment</th><th>Harm</th><th>Why out</th></tr>${opts}</table></div>
    ${c.route ? `<div class="eyebrow" style="margin:16px 0 6px">Turn-by-turn · ${c.route.eta} min${c.route.free_eta && c.route.eta > c.route.free_eta ? ` <span style="color:var(--yel)">(+${c.route.eta - c.route.free_eta} traffic)</span>` : ""} · ${(c.route.dist / 1000).toFixed(1)} km</div>
      <div class="steps">${c.route.steps.map((s, i) => `<div class="${s.slow >= 2 ? "jam" : s.slow >= 1.3 ? "slow" : ""}"><span>${i === 0 ? "▲" : i === c.route.steps.length - 1 ? "◉" : /left/.test(s.text) ? "↰" : /right/.test(s.text) ? "↱" : "↑"}</span><span>${esc(s.text)}${s.slow >= 1.3 ? " · slow" : ""}</span><span class="mono" style="color:var(--dim)">${s.dist ? (s.dist >= 1000 ? (s.dist / 1000).toFixed(1) + " km" : s.dist + " m") : ""}</span></div>`).join("")}</div>` : ""}
    <div class="eyebrow" style="margin:16px 0 6px">Timeline</div>
    <div class="events">${(c.events || []).map(esc).join("<br>")}</div>
    <div class="ctrls" style="margin-top:10px">
      <button class="btn sm" data-st="PK">Mark picked up</button><button class="btn sm" data-st="DL">Mark delivered</button></div>`;
  document.querySelectorAll(".flag").forEach((el) => (el.onclick = () => api(`/api/case/${c.id}/flag/${el.dataset.i}`, {})));
  document.querySelectorAll("[data-st]").forEach((el) => (el.onclick = () => api(`/api/case/${c.id}/status`, { status: el.dataset.st })));
}

function renderHospitals() {
  $("#hospitals").innerHTML = S.hospitals.map((h) => {
    const used = 1 - h.free / Math.max(h.total, 1);
    return `<div class="hc ${h.open ? "" : "closed"}">
      <div style="display:flex;align-items:center;gap:8px"><h4>${esc(h.name)}</h4><span class="spacer"></span><button class="switch ${h.open ? "on" : ""}" data-h="${h.id}" data-k="open" title="Open / closed"></button></div>
      <div class="meta">${h.id} · ER wait ~${h.er_wait} min${h.updated ? " · upd " + esc(h.updated) : ""}</div>
      <div style="display:flex;align-items:end;gap:12px;margin-top:8px">
        <div><div class="big" style="color:${h.free <= 1 ? "var(--red)" : h.free <= 3 ? "var(--yel)" : "var(--green)"}">${h.free}</div><div class="meta">free beds / ${h.total}</div></div>
        <span class="spacer"></span>
        <div class="stepper"><button data-h="${h.id}" data-k="free" data-d="-1">−</button><span>${h.free}</span><button data-h="${h.id}" data-k="free" data-d="1">+</button></div></div>
      <div class="meter"><i style="width:${Math.round(used * 100)}%"></i></div>
      <div style="display:flex;align-items:center;gap:8px"><div class="caps">${Object.entries(CAPS).map(([k, v]) => `<button class="cap ${h.caps.includes(k) ? "on" : ""}" data-h="${h.id}" data-cap="${k}" title="${v}">${v}</button>`).join("")}</div></div>
      <div class="meta" style="margin-top:6px">ICU free: <b>${h.icu}</b></div></div>`;
  }).join("");
  document.querySelectorAll("#hospitals [data-h]").forEach((el) => (el.onclick = () => {
    const h = S.hospitals.find((x) => x.id === el.dataset.h);
    if (el.dataset.cap) { const c = el.dataset.cap; return api(`/api/hospital/${h.id}`, { caps: h.caps.includes(c) ? h.caps.replace(c, "") : h.caps + c }); }
    if (el.dataset.k === "open") return api(`/api/hospital/${h.id}`, { open: !h.open });
    api(`/api/hospital/${h.id}`, { free: Math.max(0, h.free + Number(el.dataset.d)) });
  }));
}

function renderPharmacies() {
  if (document.activeElement && document.activeElement.closest("#pharmacies")) return;
  $("#pharmacies").innerHTML = S.pharmacies.map((p) => `<div class="hc ${p.open ? "" : "closed"}">
    <div style="display:flex;align-items:center;gap:8px"><h4>${esc(p.name)}</h4><span class="spacer"></span><button class="switch ${p.open ? "on" : ""}" data-p="${p.id}" title="Open / closed"></button></div>
    <div class="meta">${p.id} · ${p.open ? "open" : "closed"}${p.updated ? " · upd " + esc(p.updated) : ""}</div>
    <div class="stock">${Object.entries(p.stock).map(([k, v]) => `<span style="color:${v === 0 ? "var(--dim)" : v <= 3 ? "var(--yel)" : "inherit"}">${MED[k] || k}</span><input data-p="${p.id}" data-item="${k}" value="${v}" inputmode="numeric">`).join("")}</div></div>`).join("");
  document.querySelectorAll("#pharmacies .switch").forEach((el) => (el.onclick = () => { const p = S.pharmacies.find((x) => x.id === el.dataset.p); api(`/api/pharmacy/${p.id}`, { open: !p.open }); }));
  document.querySelectorAll("#pharmacies input").forEach((el) => (el.onchange = () => { el.blur(); api(`/api/pharmacy/${el.dataset.p}`, { stock: { [el.dataset.item]: Number(el.value) || 0 } }); }));
}

function renderRequests() {
  const reqs = Object.values(S.requests).reverse(), sup = Object.values(S.supplies).reverse();
  $("#reqCount").textContent = reqs.filter((r) => r.status === "asking" || r.status === "pending").length + " open";
  if (!reqs.length && !sup.length) { $("#requests").innerHTML = `<div class="empty">No medication or supply requests.</div>`; return; }
  const PN = Object.fromEntries((S.pharmacies || []).map((p) => [p.id, p.name]));
  $("#requests").innerHTML = reqs.map((r) => `<div class="req"><div style="display:flex;gap:6px;align-items:center"><b>💊 ${MED[r.item] || r.item}</b>${r.verified ? `<span class="pill" title="Matches their MedMesh ID">on ID</span>` : ""}<span class="spacer"></span><span class="pill">${r.status}</span></div>
      <div class="meta">${r.urg === "N" ? "<span style='color:#fca5a5'>out now</span>" : r.urg === "D" ? "within 24 h" : "within 3 days"} · ${r.travel ? "can travel" : "needs delivery"} · ${r.time}${r.profile ? " · " + esc(r.profile.name) : ""}</div>
      ${(r.asked || []).length && r.status === "asking" ? `<div class="meta">asked: ${r.asked.map((p) => `${esc(PN[p] || p)} ${r.answers && r.answers[p] ? (r.answers[p].ok ? "✓" : "✗") : "…"}`).join(" · ")}</div>
        <div class="ctrls" style="margin-top:6px;flex-wrap:wrap">${r.asked.filter((p) => !(r.answers || {})[p]).map((p) => `<button class="btn sm" data-r="${r.id}" data-p="${p}" data-ok="1">${esc(PN[p] || p)}: has it</button><button class="btn sm" data-r="${r.id}" data-p="${p}" data-ok="0">no</button>`).join("")}</div>` : ""}
      ${r.pharmacy_name ? `<div class="meta">→ ${esc(r.pharmacy_name)}${r.code ? ` · code <b>${r.code}</b>` : ""}</div>` : ""}</div>`).join("")
    + sup.map((s) => `<div class="req"><b>📦 Supply · ${s.hospital}</b> <span class="pill">${s.status}</span><div class="meta">${s.qty} × ${MED[s.item] || s.item} → ${s.alloc.map(([a, n]) => `${a}: ${n}`).join(", ") || "none"}${s.short ? ` · <span style="color:var(--yel)">short ${s.short}</span>` : ""}</div></div>`).join("");
  document.querySelectorAll("[data-r]").forEach((el) => (el.onclick = () => api(`/api/request/${el.dataset.r}`, { ok: el.dataset.ok === "1", minutes: 30, pharmacy: el.dataset.p })));
}

function renderNodes() {
  const sim = S.mode === "sim";
  $("#modePill").textContent = sim ? "simulator" : "live";
  const nodes = Object.values(S.nodes || {});
  $("#nodes").innerHTML = nodes.length ? nodes.map((n) => {
    const ago = n.last_heard ? Math.round(Date.now() / 1000 - n.last_heard) : null;
    return `<div class="node"><span class="dot ${n.online ? "" : "off"}"></span><div><b>${esc(n.name)}</b>${n.me ? ` <span class="pill">this laptop</span>` : ""}${n.role ? ` <span class="pill">${n.role}</span>` : ""}
      <div class="meta">${n.online ? "online" : "OFFLINE"}${n.hops != null && !n.me ? ` · ${n.hops} hop${n.hops === 1 ? "" : "s"}` : ""}${n.snr != null ? ` · SNR ${n.snr}` : ""}${ago != null && !n.me && !sim ? ` · heard ${ago < 90 ? ago + "s" : Math.round(ago / 60) + "m"} ago` : ""}</div></div>
      <span class="spacer"></span>${sim && !n.me ? `<button class="btn sm ${n.online ? "danger" : ""}" data-node="${n.id}">${n.online ? "💧 Flood node" : "Restore"}</button>` : ""}</div>`;
  }).join("") : `<div class="empty">Connecting to BASE board…</div>`;
  $("#nodeHint").textContent = sim ? "Simulated links: FIELD–RELAY–BASE and FIELD–RESP–BASE. Flood a node to watch reports take the other path." : "A node is marked offline if it hasn't been heard for 15 min. Unplug one live to show the mesh healing.";
  document.querySelectorAll("[data-node]").forEach((el) => (el.onclick = () => api(`/api/sim/node/${el.dataset.node}`, { online: !S.nodes[el.dataset.node].online })));
}

function renderLog() {
  const L = S.log || [];
  $("#log").innerHTML = L.slice(-120).reverse().map((m) => `<div><span style="color:var(--dim)">${m.t}</span><span class="${m.dir}">${m.dir === "in" ? "IN" : m.dir === "out" ? "OUT" : m.dir.toUpperCase()}</span><span>${esc(m.node)}</span><span>${esc(m.text)}${m.path ? ` <span style="color:var(--violet)">[${m.path.join("→")}]</span>` : m.hops != null ? ` <span style="color:var(--dim)">(${m.hops} hops)</span>` : ""}</span><span class="b">${m.bytes}B</span></div>`).join("") || `<div class="empty" style="display:block">No traffic yet.</div>`;
  if (MAP && lastLog >= 0) L.filter((m) => m.seq > lastLog).forEach((m) => MAP.packet(m));
  lastLog = L.length ? L[L.length - 1].seq : Math.max(lastLog, 0);
}

function renderSummary() {
  if (!S.summary) return;
  $("#summary").innerHTML = `${esc(S.summary.text)}<div class="ai-note">${S.summary.t} · ${S.summary.by === "template" ? "facts only (start Ollama for AI summary)" : "offline AI · " + esc(S.summary.by)}</div>`;
}

/* ---------------------------------------------------------------- controls */
$("#sumBtn").onclick = () => { $("#summary").innerHTML = `<span class="hint">Thinking…</span>`; api("/api/summary", {}); };
$("#scenarioBtn").onclick = () => api("/api/sim/scenario", {}).then((r) => r.ok || toast("Scenario only works in simulator mode"));
$("#blockBtn").onclick = () => api("/api/block", { road: $("#roadSel").value }).then(() => toast(`⛔ ${$("#roadSel").value} blocked: rerouting affected ambulances`));
$("#clearBtn").onclick = async () => { for (const r of S.blocked) await api("/api/block", { road: r, clear: true }); for (const r of Object.keys(S.slow || {})) await api("/api/slow", { road: r, clear: true }); await api("/api/sim/traffic", { clear: true }); api("/api/flood", { clear: true }); };
$("#slowBtn").onclick = () => api("/api/slow", { road: $("#roadSel").value, factor: 3, reason: "evacuation traffic" }).then(() => toast(`🐢 ${$("#roadSel").value} marked slow: routes avoid it if there's a faster option`));
$("#jamBtn").onclick = () => api("/api/sim/traffic", { road: $("#roadSel").value, factor: 5 }).then(() => toast(`🚗 Hidden jam on ${$("#roadSel").value}. Watch an ambulance discover it`));
$("#alertBtn").onclick = () => { const t = $("#alertTxt").value.trim(); if (!t) return; api("/api/alert", { text: t, level: $("#alertLvl").value }).then(() => { $("#alertTxt").value = ""; toast("📣 Alert broadcast to every phone on the mesh"); }); };
$("#vStreet").onclick = () => setView("street"); $("#v3d").onclick = () => setView("3d");
function setView(v) {
  $("#street").style.display = v === "street" ? "block" : "none"; $("#map").style.display = $("#labels").style.display = v === "3d" ? "block" : "none";
  $("#vStreet").classList.toggle("on", v === "street"); $("#v3d").classList.toggle("on", v === "3d");
  $("#floodBtn").style.display = ""; if (v === "3d" && MAP) MAP.update(S, sel);
}
$("#resetBtn").onclick = () => { seenCases.clear(); sel = null; lastLog = 0; api("/api/reset", {}); };
$("#floodBtn").onclick = () => { const on = $("#map").classList.toggle("flood"); $("#floodBtn").classList.toggle("on", on); if (on) toast("Click on the map to drop a 400 m flood zone"); };
$("#viewBtn").onclick = () => { if (MAP) MAP.resetView(); if (STREET) { STREET.fit(); lastFitSel = sel; } };

/* ---------------------------------------------------------------- 3D aerial map */
function makeMap(roads, source) {
  if (!window.THREE) return null;
  const T = THREE, canvas = $("#map"), host = $("#mapCard"), labelsEl = $("#labels");
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new T.Scene(); scene.fog = new T.Fog(0x05070f, 16, 40);
  const cam = new T.PerspectiveCamera(42, 1, 0.1, 200);
  const C = { sky: new T.Color("#7dd3fc"), blue: new T.Color("#3b82f6"), green: new T.Color("#34d399"), red: new T.Color("#ef4444"), yel: new T.Color("#fbbf24"), violet: new T.Color("#818cf8"), amber: new T.Color("#f59e0b"), water: new T.Color("#60a5fa"), dim: new T.Color("#1e293b") };
  // projection lat/lon -> x/z
  const lats = roads.flatMap((r) => [r.a[0], r.b[0]]), lons = roads.flatMap((r) => [r.a[1], r.b[1]]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const kx = Math.cos(lat0 * Math.PI / 180), spanM = Math.max((Math.max(...lons) - Math.min(...lons)) * 111320 * kx, (Math.max(...lats) - Math.min(...lats)) * 111320);
  const U = 18 / spanM; // units per metre
  const P = (lat, lon, y = 0) => new T.Vector3((lon - lon0) * 111320 * kx * U, y, -(lat - lat0) * 111320 * U);
  const unP = (x, z) => [lat0 - z / (111320 * U), lon0 + x / (111320 * kx * U)];
  // ground point cloud
  const pts = [], cols = [];
  for (let x = -12; x <= 12; x += 0.3) for (let z = -9; z <= 9; z += 0.3) {
    const j = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, r = j - Math.floor(j);
    if (r < 0.4) continue;
    pts.push(x + (r - .5) * .1, -0.01, z + (r - .5) * .1);
    const k = 0.18 + 0.4 * r * Math.exp(-(x * x) / 160 - (z * z) / 90); cols.push(C.sky.r * k, C.sky.g * k, C.sky.b * k);
  }
  const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); gg.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
  scene.add(new T.Points(gg, new T.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.85 })));
  // roads
  const rp = []; roads.forEach((r) => { const a = P(r.a[0], r.a[1], .005), b = P(r.b[0], r.b[1], .005); rp.push(a.x, a.y, a.z, b.x, b.y, b.z); });
  const rg = new T.BufferGeometry(); rg.setAttribute("position", new T.Float32BufferAttribute(rp, 3));
  scene.add(new T.LineSegments(rg, new T.LineBasicMaterial({ color: C.sky, transparent: true, opacity: 0.38 })));
  // road name labels (one per road, at its middle segment)
  const byName = {}; roads.forEach((r) => (byName[r.name] = byName[r.name] || []).push(r));
  const roadLabels = source === "grid" ? Object.entries(byName).map(([n, segs]) => { const s = segs[Math.floor(segs.length / 2)]; return { n, v: P((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, 0.02) }; }) : [];

  // ribbon helper: flat strip along polyline (WebGL lines are 1px)
  function ribbon(coords, w, color, y, opacity = 0.95) {
    const v = coords.map((c) => P(c[0], c[1], y)), pos = [], idx = [];
    for (let i = 0; i < v.length; i++) {
      const a = v[Math.max(0, i - 1)], b = v[Math.min(v.length - 1, i + 1)];
      const d = new T.Vector3().subVectors(b, a); d.y = 0; d.normalize();
      const n = new T.Vector3(-d.z, 0, d.x).multiplyScalar(w / 2);
      pos.push(v[i].x + n.x, y, v[i].z + n.z, v[i].x - n.x, y, v[i].z - n.z);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return new T.Mesh(g, new T.MeshBasicMaterial({ color, transparent: true, opacity, side: T.DoubleSide, depthWrite: false }));
  }
  function beacon(v, color, h = 1.1) {
    const g = new T.Group();
    const ring = new T.Mesh(new T.RingGeometry(0.2, 0.25, 40), new T.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .01;
    const pole = new T.Mesh(new T.CylinderGeometry(.012, .012, h, 8), new T.MeshBasicMaterial({ color, transparent: true, opacity: .6 }));
    pole.position.y = h / 2; g.add(ring, pole); g.position.copy(v); g.userData.ring = ring; return g;
  }
  function polyAlong(coords, y) { return coords.map((c) => P(c[0], c[1], y)); }
  function along(pts, t) {
    if (pts.length < 2) return pts[0];
    const L = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); L.push(d); tot += d; }
    let d = t * tot, i = 0; while (i < L.length - 1 && d > L[i]) { d -= L[i]; i++; }
    return new T.Vector3().lerpVectors(pts[i], pts[i + 1], L[i] ? d / L[i] : 0);
  }

  const dyn = new T.Group(); scene.add(dyn);
  const packets = new T.Group(); scene.add(packets);
  let labels = [], movers = [], pulses = [], nodePos = {}, state = null;
  const lab = (cls, html, v) => { const d = document.createElement("div"); d.className = "lab " + cls; d.innerHTML = html; labelsEl.appendChild(d); labels.push({ d, v }); };

  function update(s, selId) {
    state = s;
    dyn.clear(); labelsEl.innerHTML = ""; labels = []; movers = []; pulses = [];
    roadLabels.forEach((r) => lab("", `<small>${esc(r.n)}</small>`, r.v));
    // blocked roads + floods
    s.blocked.forEach((name) => (byName[name] || []).forEach((r) => {
      dyn.add(ribbon([r.a, r.b], .16, C.water, .02, .9));
    }));
    s.blocked.forEach((name) => { const segs = byName[name]; if (segs) { const m = segs[Math.floor(segs.length / 2)]; lab("", `<span style="color:#93c5fd">⛔ ${esc(name)}</span>`, P((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, .1)); } });
    s.floods.forEach((f) => {
      const disc = new T.Mesh(new T.CircleGeometry(f.r * U, 48), new T.MeshBasicMaterial({ color: C.water, transparent: true, opacity: .22, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.copy(P(f.lat, f.lon, .015)); dyn.add(disc);
      const ring = new T.Mesh(new T.RingGeometry(f.r * U - .03, f.r * U, 64), new T.MeshBasicMaterial({ color: C.water, transparent: true, opacity: .8, side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(P(f.lat, f.lon, .016)); dyn.add(ring); pulses.push(ring);
      lab("", `<span style="color:#93c5fd">💧 flood zone</span>`, P(f.lat, f.lon, .1));
    });
    // EMS
    const ev = P(s.ems.lat, s.ems.lon); const eb = new T.Mesh(new T.BoxGeometry(.22, .16, .22), new T.MeshBasicMaterial({ color: C.sky })); eb.position.copy(ev).setY(.08); dyn.add(eb);
    lab("", `🚑 EMS`, P(s.ems.lat, s.ems.lon, .35));
    // hospitals
    const selCase = s.cases[selId];
    s.hospitals.forEach((h) => {
      const v = P(h.lat, h.lon), win = selCase && selCase.hospital === h.id;
      const b = beacon(v, !h.open ? C.red : win ? C.green : C.sky, 1.2); dyn.add(b); pulses.push(b.userData.ring);
      lab(win ? "best" : "h", `${esc(h.name.toUpperCase())}<small>${h.open ? `${h.free} beds · ${h.caps || "minor"}` : "CLOSED"}</small>`, P(h.lat, h.lon, 1.35));
    });
    // pharmacies
    s.pharmacies.forEach((p) => {
      const m = new T.Mesh(new T.OctahedronGeometry(.11), new T.MeshBasicMaterial({ color: p.open ? C.amber : C.dim, wireframe: true }));
      m.position.copy(P(p.lat, p.lon, .2)); dyn.add(m); movers.push({ spin: m });
      lab("", `<span style="color:${p.open ? "#fbbf24" : "#71717a"}">💊 ${esc(p.name)}</span>`, P(p.lat, p.lon, .5));
    });
    // mesh nodes (boards) + links
    nodePos = {};
    const nodes = Object.values(s.nodes || {});
    nodes.forEach((n, i) => {
      const key = (n.name || "").toUpperCase(), lay = s.layout[key] || s.layout[Object.keys(s.layout).find((k) => key.includes(k))];
      const ll = lay || [43.79 - 0.01 * i, -79.27 + 0.012 * i];
      nodePos[n.id] = P(ll[0], ll[1], 1.6); nodePos[n.name] = nodePos[n.id];
      const sph = new T.Mesh(new T.SphereGeometry(.13, 20, 20), new T.MeshBasicMaterial({ color: n.online ? C.violet : C.red }));
      sph.position.copy(nodePos[n.id]); dyn.add(sph);
      const halo = new T.Mesh(new T.SphereGeometry(.28, 20, 20), new T.MeshBasicMaterial({ color: n.online ? C.violet : C.red, transparent: true, opacity: .15 }));
      halo.position.copy(nodePos[n.id]); dyn.add(halo); if (n.online) pulses.push(halo);
      const stem = new T.Mesh(new T.CylinderGeometry(.008, .008, 1.6, 6), new T.MeshBasicMaterial({ color: C.violet, transparent: true, opacity: .35 }));
      stem.position.copy(nodePos[n.id]).setY(.8); dyn.add(stem);
      lab("node " + (n.online ? "" : "off"), `◆ ${esc(n.name)}<small>${n.online ? (n.role || (n.me ? "base station" : "node")) : "OFFLINE"}</small>`, nodePos[n.id].clone().setY(1.95));
    });
    const links = s.mode === "sim" ? [["FIELD", "RELAY"], ["RELAY", "BASE"], ["FIELD", "RESP"], ["RESP", "BASE"], ...nodes.filter((n) => !["FIELD", "RELAY", "RESP", "BASE"].includes(n.id)).map((n) => [n.id, "BASE"])] : nodes.filter((n) => !n.me).map((n) => [n.id, (nodes.find((x) => x.me) || {}).id]);
    links.forEach(([a, b]) => {
      const A = nodePos[a], B = nodePos[b]; if (!A || !B) return;
      const up = s.nodes[a]?.online !== false && s.nodes[b]?.online !== false;
      const g = new T.BufferGeometry().setFromPoints([A, B]);
      const line = new T.Line(g, new T.LineDashedMaterial({ color: up ? C.violet : C.red, dashSize: .12, gapSize: .1, transparent: true, opacity: up ? .75 : .3 }));
      line.computeLineDistances(); dyn.add(line);
    });
    // cases: markers, routes, ambulances
    Object.values(s.cases).forEach((c) => {
      if (c.status === "delivered") return;
      const col = c.triage === 1 ? C.red : c.triage === 2 ? C.yel : c.triage === 3 ? C.green : C.dim;
      const v = P(c.loc[0], c.loc[1]);
      const pin = new T.Mesh(new T.ConeGeometry(.12, .45, 16), new T.MeshBasicMaterial({ color: col })); pin.rotation.x = Math.PI; pin.position.copy(v).setY(.3); dyn.add(pin);
      const ring = new T.Mesh(new T.RingGeometry(.15, .2, 32), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.copy(v).setY(.02); dyn.add(ring); pulses.push(ring);
      lab("case" + c.triage, `${c.triage === 1 ? "🔴" : c.triage === 2 ? "🟡" : "🟢"} ${esc(CMP[c.complaint] || c.complaint)}<small>${c.id}</small>`, P(c.loc[0], c.loc[1], .7));
      const isSel = c.id === selId;
      if (c.pickup_route && (isSel || c.status === "dispatched")) dyn.add(ribbon(c.pickup_route.coords, isSel ? .09 : .05, C.sky, .03, isSel ? .9 : .45));
      if (c.route) {
        const rib = ribbon(c.route.coords, isSel ? .12 : .06, C.green, .035, isSel ? .95 : .5); dyn.add(rib);
        const pathPts = [...(c.status === "dispatched" && c.pickup_route ? polyAlong(c.pickup_route.coords, .12) : []), ...polyAlong(c.route.coords, .12)];
        const amb = new T.Group();
        amb.add(new T.Mesh(new T.BoxGeometry(.2, .1, .1), new T.MeshBasicMaterial({ color: C.green })));
        amb.add(new T.Mesh(new T.SphereGeometry(.18, 14, 14), new T.MeshBasicMaterial({ color: C.green, transparent: true, opacity: .18 })));
        dyn.add(amb); movers.push({ amb, pts: pathPts, speed: 0.06 + Math.random() * .02, t: Math.random() });
      }
    });
  }

  // packet animation along mesh path
  function packet(m) {
    if (m.dir !== "in" && m.dir !== "out") return;
    let path = m.path;
    if (!path) { const base = Object.values(state?.nodes || {}).find((n) => n.me); const from = Object.values(state?.nodes || {}).find((n) => n.name === m.node || n.id === m.node); if (!base || !from) return; path = [from.id, base.id]; }
    const pts = (m.dir === "out" ? [...path].reverse() : path).map((k) => nodePos[k]).filter(Boolean);
    if (pts.length < 2) return;
    const dot = new T.Mesh(new T.SphereGeometry(.09, 12, 12), new T.MeshBasicMaterial({ color: m.dir === "in" ? C.yel : C.green }));
    packets.add(dot); movers.push({ packet: dot, pts, t: 0, speed: 0.9 / (pts.length - 1) });
  }

  // camera orbit
  const V = { theta: -0.3, phi: 0.92, r: 15.5, target: new T.Vector3(0, 0, 0) };
  const resetView = () => Object.assign(V, { theta: -0.3, phi: 0.92, r: 15.5 });
  let drag = null, idle = 0;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; V.theta -= dx * 0.005; V.phi = Math.min(1.45, Math.max(0.25, V.phi - dy * 0.004)); drag.x = e.clientX; drag.y = e.clientY; idle = 0; });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && canvas.classList.contains("flood")) {
      const r = canvas.getBoundingClientRect(), ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new T.Raycaster(); ray.setFromCamera(ndc, cam); const hit = new T.Vector3();
      if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), hit)) {
        const [la, lo] = unP(hit.x, hit.z); api("/api/flood", { lat: la, lon: lo, r: 400 }); toast("💧 Flood zone added: rerouting through it");
        canvas.classList.remove("flood"); $("#floodBtn").classList.remove("on");
      }
    }
    drag = null;
  });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); V.r = Math.min(40, Math.max(7, V.r * (1 + Math.sign(e.deltaY) * 0.08))); idle = 0; }, { passive: false });

  const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = Math.min(64, Math.max(42, 42 * Math.sqrt(1.7 / cam.aspect))); cam.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(host); resize();
  const clock = new T.Clock(), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    idle += dt; if (idle > 6 && !drag && !reduced) V.theta += dt * 0.03;
    cam.position.set(V.target.x + V.r * Math.sin(V.phi) * Math.sin(V.theta), V.r * Math.cos(V.phi), V.target.z + V.r * Math.sin(V.phi) * Math.cos(V.theta));
    cam.lookAt(V.target);
    pulses.forEach((p, i) => p.scale.setScalar(1 + (reduced ? 0 : 0.18 * Math.sin(t * 3 + i))));
    for (let i = movers.length - 1; i >= 0; i--) {
      const m = movers[i];
      if (m.spin) { m.spin.rotation.y += dt; continue; }
      if (m.amb && m.pts.length > 1) { m.t = (m.t + dt * m.speed) % 1; m.amb.position.copy(along(m.pts, m.t)); continue; }
      if (m.packet) { m.t += dt * m.speed; if (m.t >= 1) { packets.remove(m.packet); movers.splice(i, 1); continue; } m.packet.position.copy(along(m.pts, m.t)); }
    }
    renderer.render(scene, cam);
    const w = host.clientWidth, h = host.clientHeight;
    labels.forEach(({ d, v }) => { const p = v.clone().project(cam); const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1; d.style.display = vis ? "" : "none"; if (vis) { d.style.left = ((p.x + 1) / 2) * w + "px"; d.style.top = ((1 - p.y) / 2) * h + "px"; } });
  })();
  return { update, packet, resetView };
}

api("/api/map").then((geo) => {
  GEO = geo;
  $("#mapSub").textContent = `${geo.source === "osm" ? "OpenStreetMap, stored offline" : "simplified road grid (run prepare_map.py for real streets)"} · drag, scroll or pinch`;
  $("#roadSel").innerHTML = geo.names.map((n) => `<option>${esc(n)}</option>`).join("");
  const segs = geo.roads.flatMap((r) => r.g.slice(1).map((p, i) => ({ name: r.name, a: r.g[i], b: p })));
  MAP = makeMap(segs, geo.source);
  STREET = new MedMapLib.MedMap($("#street"), {
    onClick: (ll, hit) => {
      if ($("#map").classList.contains("flood")) { api("/api/flood", { lat: ll[0], lon: ll[1], r: 400 }); toast("💧 Flood zone added: rerouting through it"); $("#map").classList.remove("flood"); $("#floodBtn").classList.remove("on"); return; }
      if (hit && hit.id) { sel = hit.id; lastFitSel = null; render(); }
    },
  });
  STREET.setData(geo);
  connect();
});
})();
