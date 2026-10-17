// MedMesh mobile app: Patient / Responder / Hospital / Pharmacy, all over the LoRa mesh.
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Link } from "./link.js";
import { MedMap, routeLocal } from "./mapview.js";
import { GUIDES, PLACES, distM, Metronome } from "./extras.js";
import { ic } from "./icons.js";
import { meshStrip } from "./fx.js";
import { aerial3d } from "./aerial3d.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rid = () => Math.random().toString(36).slice(2, 6);
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
const store = {
  get(k, d) { try { const v = localStorage.getItem("mm_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("mm_" + k, JSON.stringify(v)); } catch (e) {} },
};
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? "now" : s < 60 ? s + "s ago" : s < 3600 ? Math.floor(s / 60) + "m ago" : Math.floor(s / 3600) + "h ago"; };

// ------------------------------------------------------------------ reference data (matches the base station)
const HOSP_LL = { SGH: [43.7556, -79.2462], CEN: [43.7783, -79.2053], BIR: [43.8039, -79.3005], UFC: [43.7839, -79.1874] };
const EMS_LL = [43.7790, -79.2260];
const HOSP_DEFAULT = { SGH: { free: 4, icu: 1, caps: "CT" }, CEN: { free: 6, icu: 2, caps: "CTOP" }, BIR: { free: 3, icu: 0, caps: "T" }, UFC: { free: 8, icu: 0, caps: "" } };
const PHARM_DEFAULT = { MSP: { INSULIN: 12, INHALER: 20, EPIPEN: 4, HEART: 30, SEIZURE: 8, BP: 40 }, ECP: { INSULIN: 5, INHALER: 6, EPIPEN: 10, HEART: 12, SEIZURE: 2, BP: 15 }, MVR: { INSULIN: 20, INHALER: 15, EPIPEN: 6, HEART: 25, SEIZURE: 10, BP: 30 } };
const HOSPITALS = { SGH: "Scarborough General", CEN: "Centenary Hospital", BIR: "Birchmount Hospital", UFC: "UTSC Field Clinic" };
const PHARMACIES = { MSP: "Morningside Pharmacy", ECP: "Ellesmere Community Rx", MVR: "Malvern Rx" };
const MEDS = { INSULIN: "Insulin", INHALER: "Inhaler", EPIPEN: "EpiPen", HEART: "Heart medication", SEIZURE: "Seizure medication", BP: "Blood-pressure medication", ONEG: "O-neg blood", OTHER: "Other" };
const MED_IC = { INSULIN: "syringe", INHALER: "wind", EPIPEN: "syringe", HEART: "heart", SEIZURE: "brain", BP: "gauge", ONEG: "drop", OTHER: "pill" };
const CAPS = { C: ["Cardiac", "heart"], T: ["Trauma", "bone"], B: ["Burns", "flame"], O: ["Obstetrics", "baby"], P: ["Paediatrics", "users"] };
const CMP = { CP: ["heart", "Chest pain"], BR: ["wind", "Trouble breathing"], BL: ["drop", "Bleeding / injury"], BU: ["flame", "Burn"], UN: ["eyeoff", "Unconscious / fainted"], PR: ["baby", "Pregnancy"], FX: ["bone", "Fall / broken bone"], OT: ["plus", "Something else"] };
const TRI = { 1: ["IMMEDIATE", "red"], 2: ["DELAYED", "yellow"], 3: ["MINOR", "green"], 4: ["EXPECTANT", "black"] };
const ROADS = ["Finch Ave E", "Sheppard Ave E", "Hwy 401", "Ellesmere Rd", "Lawrence Ave E", "Eglinton Ave E", "Birchmount Rd", "Kennedy Rd", "Midland Ave", "Brimley Rd", "McCowan Rd", "Markham Rd", "Morningside Ave", "Military Trail", "Meadowvale Rd"];
const SITES = { FIELD: [43.7712, -79.1931], "Shelter A (UTSC)": [43.7839, -79.1874], "Shelter B (Malvern CC)": [43.8060, -79.2200], "School gym (Lawrence)": [43.7640, -79.2300] };
const GUIDE_IC = { cpr: "heartpulse", bleed: "drop", choke: "wind", burn: "flame", seizure: "zap", allergy: "syringe", fracture: "bone", cold: "snow", recovery: "bed" };
const FIRST_AID = {
  CP: ["Keep them seated and calm", "Loosen tight clothing", "If they have prescribed nitroglycerin, help them take it", "If they collapse and aren't breathing, start CPR"],
  BR: ["Sit them upright, leaning forward", "Help with their inhaler if they have one", "Keep them calm, slow breaths"],
  BL: ["Press firmly on the wound with a clean cloth", "Don't remove the cloth: add more on top", "Raise the limb if possible"],
  BU: ["Cool with clean running water for 20 min", "Remove rings/watches near the burn", "Cover loosely with clean plastic wrap"],
  UN: ["Check breathing", "If breathing, roll onto their side (recovery position)", "If not breathing, start CPR"],
  PR: ["Help her lie on her left side", "Time contractions", "Keep her warm"],
  FX: ["Don't move the injured limb", "Support it with padding", "Watch for signs of shock (pale, cold, sweaty)"],
  OT: ["Stay with them", "Keep them warm and still", "Watch their breathing"],
};
const MSG_NAME = { R: "Emergency report", M: "Medication request", Q: "Where-to-go question", U: "Job status", B: "Road blocked", F: "Flood zone", K: "Slow traffic", L: "GPS position", C: "Hospital capacity", S: "Supply request", P: "Pharmacy stock", PA: "Pharmacy answer", O: "Check-in", J: "Joined mesh", A: "Delivery receipt", H: "Help update", D: "Dispatch", RR: "Reroute", T: "Delivery task", I: "Incoming patient", MR: "Medication request", MA: "Medication answer", SR: "Supply request", SA: "Supply allocated", W: "Go to", N: "Broadcast alert" };

// ------------------------------------------------------------------ app state
const link = new Link();
const A = {
  role: null, ref: store.get("ref", ""), label: store.get("label", ""), // always open on the landing (role) screen
  base: store.get("base", location.origin.startsWith("http") ? location.origin : "http://localhost:8000"),
  simNode: store.get("simNode", "FIELD"), baseHint: store.get("baseHint", "BASE"),
  profile: store.get("profile", null),
  feed: [], sent: {}, screen: "home", q: null, inbox: [], hospital: null, pharmacy: null, alerts: [], cases: [], dir: "fwd", seenAlerts: 0,
};
const ROLE = {
  patient: ["user", "Community member", "Get help, medicine and directions", "sky"],
  responder: ["amb", "Responder", "Dispatches, live routes, road reports", "green"],
  hospital: ["hospital", "Hospital", "Beds, incoming patients, supplies", "blue"],
  pharmacy: ["pill", "Pharmacy", "Stock levels and medicine requests", "amber"],
};
const JOIN = { patient: "P", responder: "R", hospital: "H", pharmacy: "X" };

// ------------------------------------------------------------------ messaging
async function send(text, note) {
  const id = text.split("|")[1];
  const entry = { id, text, note, t: new Date().toLocaleTimeString("en-CA", { hour12: false }), at: Date.now(), state: "sending" };
  A.sent[id] = entry; addFeed({ dir: "out", text, note }); render();
  try {
    const r = await Promise.race([link.send(text), new Promise((res) => setTimeout(() => res({ mesh: false, timeout: true }), 25000))]);
    entry.state = r.timeout ? "sent" : "delivered"; entry.path = r.path;
    buzz(20);
  } catch (e) { entry.state = "failed"; entry.error = e.message; toast("x", "Not sent", e.message, "red"); }
  render();
  return entry;
}
function addFeed(m) { A.feed.unshift({ ...m, at: Date.now(), t: new Date().toLocaleTimeString("en-CA", { hour12: false }) }); A.feed = A.feed.slice(0, 80); }

link.on("status", () => {
  if (link.status === "connected" && A.role) { link.send(`J|${JOIN[A.role]}|${A.ref}|${A.label || ROLE[A.role][1]}`).catch(() => {}); toast("radio", "Connected to the mesh", link.kind === "sim" ? "Simulated node " + link.nodeName : link.nodeName || "MedMesh node", "green"); }
  render();
});
link.on("message", (text) => {
  addFeed({ dir: "in", text });
  const [t, ...f] = text.split("|");
  if (t === "A" && A.sent[f[0]]) A.sent[f[0]].state = "received";
  const mine = (id) => !!A.sent[id];
  if (t === "N") {
    if (!A.alerts.some((a) => a.id === f[0])) A.alerts.unshift({ id: f[0], level: f[1], text: f.slice(2).join("|"), at: Date.now() });
    buzz([300, 100, 300, 100, 300]);
    toast(f[1] === "EVAC" ? "siren" : f[1] === "WARN" ? "warn" : "megaphone", f[1] === "EVAC" ? "Evacuation order" : f[1] === "WARN" ? "Warning" : "Update", f.slice(2).join("|"), f[1] === "EVAC" ? "red" : f[1] === "WARN" ? "amber" : "sky", () => go("alerts"));
  }
  if (A.role === "patient" && ["H", "MA", "W"].includes(t) && mine(f[0])) {
    A.inbox.unshift({ t, f, at: Date.now() });
    if (t === "H") toast(f[1] === "PK" ? "check" : f[1] === "RR" ? "route" : "amb", { AMB: "Ambulance on the way", RR: "Route changed", PK: "Paramedics are with you", WAIT: "Request received" }[f[1]] || "Update", f[2] && f[2] !== "0" ? `ETA ${f[2]} min · ${f[3] || ""}` : f[3] || "", "green", () => openTrack(f[0]));
    if (t === "MA") toast("pill", f[1] === "NONE" ? "Medication not available" : "Medication sorted", f[4] || "", f[1] === "NONE" ? "amber" : "green", () => go("med"));
    if (t === "W") toast("hospital", "Go to " + (f[3] || f[1]), f[2] && f[2] !== "0" ? f[2] + " min by road" : "", "sky", () => go("where"));
  }
  if (A.role === "responder" && ["D", "RR", "T"].includes(t)) {
    A.inbox.unshift({ t, f, at: Date.now() });
    if (t === "D") toast("siren", "New dispatch · " + (TRI[f[1]]?.[0] || ""), `${CMP[f[2]]?.[1] || f[2]} → ${HOSPITALS[f[4]] || f[4]}`, "red", () => go("home"));
    if (t === "RR") toast("route", "Rerouted", `${HOSPITALS[f[1]] || f[1]} · ${f[2]} min via ${f[3]}`, "sky", () => go("home"));
    if (t === "T") toast("box", "Delivery task", `${MEDS[f[2]] || f[2]} from ${PHARMACIES[f[1]] || f[1]}`, "amber", () => go("home"));
  }
  if (A.role === "hospital" && (t === "I" ? true : t === "SA" && mine(f[0]))) {
    A.inbox.unshift({ t, f, at: Date.now() });
    if (t === "I") toast("amb", "Incoming · " + (TRI[f[1]]?.[0] || ""), `${CMP[f[2]]?.[1] || f[2]} · ETA ${String(f[4] || "").replace("+", " + ")} min`, "red");
    if (t === "SA") toast("box", "Supplies allocated", f[1].replace(/:/g, " × "), "green");
  }
  if (A.role === "pharmacy" && ["MR", "SR"].includes(t)) {
    A.inbox.unshift({ t, f, at: Date.now(), state: "new" });
    toast(t === "MR" ? "pill" : "box", t === "MR" ? "Medication request" : "Hospital supply", t === "MR" ? `${MEDS[f[1]] || f[1]} · ${f[2] === "N" ? "OUT NOW" : f[2] === "D" ? "within 24 h" : "3 days"}` : `${f[3]} × ${MEDS[f[2]] || f[2]} for ${HOSPITALS[f[1]] || f[1]}`, "amber");
  }
  if (t !== "A" && t !== "N") buzz([120, 60, 120]);
  render();
});

// ------------------------------------------------------------------ toasts (live notifications that survive re-renders)
function toast(icon, title, body = "", tone = "sky", onTap) {
  let box = $("#toasts"); if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = "toast " + tone;
  el.innerHTML = `<span class="tico">${ic(icon)}</span><div><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ""}</div>`;
  el.onclick = () => { el.classList.add("out"); setTimeout(() => el.remove(), 250); onTap && onTap(); };
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 4800);
}

// ------------------------------------------------------------------ UI building blocks
const connected = () => link.status === "connected";
function meshPill() {
  const ok = connected(), st = link.status;
  return `<button class="meshpill ${ok ? "ok" : st === "connecting" ? "wait" : "bad"}" data-go="connect"><i></i>${ok ? (link.kind === "sim" ? "Sim · " : "") + esc(link.nodeName || "Mesh") : st === "connecting" ? "Connecting" : "Offline"}</button>`;
}
function hdrLarge(title, sub) {
  const initials = (A.profile?.name || ROLE[A.role]?.[1] || "M").split(" ").map((x) => x[0]).slice(0, 2).join("");
  return `<header class="lhdr"><div class="lrow">${meshPill()}<span class="sp"></span><button class="avatar" data-go="settings" aria-label="Settings">${esc(initials)}</button></div>
    <div class="ltitle stag">${title}</div>${sub ? `<div class="lsub stag">${sub}</div>` : ""}</header>`;
}
function hdr(title, back = "home", right = "") {
  return `<header class="hdr"><button class="iconbtn" data-back="${back}" aria-label="Back">${ic("left")}</button><div class="htitle">${title}</div>${right || `<span class="iconbtn ghost"></span>`}</header>${connected() ? "" : `<button class="offbar" data-go="connect">${ic("offline")} Not connected to a node · tap to connect</button>`}`;
}
const opt = (val, label, sub = "", cls = "", icon = "") => `<button class="opt ${cls}" data-v="${esc(val)}">${icon ? `<span class="oic">${ic(icon)}</span>` : ""}<span class="otx"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><span class="radio">${ic("check", "", 3)}</span></button>`;
const tick = (s) => ({
  sending: `<span class="pill wait"><i class="spin"></i>Sending</span>`, sent: `<span class="pill">${ic("check")}Sent</span>`,
  delivered: `<span class="pill ok">${ic("check")}Delivered to mesh</span>`, received: `<span class="pill ok">${ic("check2")}Received by command centre</span>`,
  failed: `<span class="pill bad">${ic("x")}Not sent</span>`,
}[s] || "");
const triPill = (t) => { const [n, c] = TRI[t] || ["?", ""]; return `<span class="tri ${c}">${n}</span>`; };

const TABS = {
  patient: [["home", "home", "Home"], ["nearby", "map", "Nearby"], ["sos", "siren", "SOS"], ["alerts", "bell", "Alerts"], ["myid", "id", "My ID"]],
  responder: [["home", "amb", "Dispatch"], ["block", "cone", "Report"], ["log", "msgs", "Radio"], ["settings", "settings", "Settings"]],
  hospital: [["home", "hospital", "Hospital"], ["log", "msgs", "Radio"], ["settings", "settings", "Settings"]],
  pharmacy: [["home", "store", "Pharmacy"], ["log", "msgs", "Radio"], ["settings", "settings", "Settings"]],
};
const TABBED = ["home", "nearby", "alerts", "myid", "log", "settings", "block", "firstaid"];
function tabbar() {
  const unread = A.alerts.length - A.seenAlerts;
  return `<nav class="tabbar">${TABS[A.role].map(([k, i, l]) => k === "sos"
    ? `<button class="tab sostab" data-go="emergency" aria-label="SOS">${ic("siren")}</button>`
    : `<button class="tab ${A.screen === k ? "on" : ""}" data-tab="${k}">${ic(i)}<span>${l}</span>${k === "alerts" && unread > 0 ? `<em>${unread}</em>` : ""}</button>`).join("")}</nav>`;
}

// ------------------------------------------------------------------ screens
const screens = {};

screens.role = () => `<div class="fshero">
    <div class="brand"><span class="logo">${ic("heartpulse", "", 2.4)}</span>MedMesh<span class="sp"></span><button class="ghostlink" data-role="patient">Get started ${ic("right", "sm")}</button></div>
    <div class="badge stag"><i></i>Live in Scarborough · works with no cell service</div>
    <h1 class="stag">Emergency care that works <span class="grad">when the network</span> doesn't.</h1>
    <p class="stag">MedMesh links phones, hospitals and pharmacies over a community LoRa radio mesh. Ask for help, get triaged and routed, with no towers and no internet.</p>
    <div class="aerial3d stag" id="a3d"><canvas></canvas><div class="a3lbls"></div><div class="a3card"></div><span class="a3hint">Drag to rotate</span></div>
    <div class="checks stag"><span>${ic("check", "sm")}No cell needed</span><span>${ic("check", "sm")}&lt;200 bytes a message</span><span>${ic("check", "sm")}Self-healing mesh</span></div>
  </div>
  <div class="pad">
    <div class="eyebrow stag">Who is using this phone?</div>
    ${Object.entries(ROLE).map(([k, [i, n, d, tone]]) => `<button class="rolecard stag" data-role="${k}"><span class="squircle ${tone}">${ic(i)}</span><span class="otx"><b>${n}</b><small>${d}</small></span>${ic("right", "chev")}</button>`).join("")}
  </div>`;

screens.roleref = () => {
  const list = A.role === "hospital" ? HOSPITALS : PHARMACIES;
  return `${hdr("Which " + (A.role === "hospital" ? "hospital" : "pharmacy") + "?", "role")}<div class="pad">
  ${Object.entries(list).map(([k, v]) => `<button class="rolecard stag" data-ref="${k}"><span class="squircle ${A.role === "hospital" ? "blue" : "amber"}">${ic(A.role === "hospital" ? "hospital" : "store")}</span><span class="otx"><b>${v}</b><small class="mono">${k}</small></span>${ic("right", "chev")}</button>`).join("")}</div>`;
};

screens.connect = () => {
  const sup = Link.support(), st = link.status;
  return `${hdr("Connect to the mesh", A.role ? "home" : "role").replace(/<button class="offbar"[\s\S]*?<\/button>/, "")}<div class="pad">
  <div class="radar ${st === "connecting" ? "busy" : connected() ? "done" : ""}"><span></span><span></span><span></span><b>${ic(connected() ? "check" : "radio", "", 2.2)}</b></div>
  <p class="center muted">${connected() ? `Connected to <b class="ink">${esc(link.nodeName || "node")}</b>${link.kind === "sim" ? " (simulator)" : ""}` : st === "connecting" ? "Looking for a MedMesh node…" : "Your phone pairs with the nearest node over Bluetooth (about 10 m). The node carries your message across the mesh."}</p>
  <button class="method stag" id="cBle" ${sup.ble ? "" : "disabled"}><span class="squircle sky">${ic("ble")}</span><span class="otx"><b>Bluetooth node</b><small>${sup.ble ? "Nearest MedMesh radio" : sup.secure ? "Not in this browser. Android: Chrome · iPhone: Bluefy" : "Needs the https link"}</small></span>${ic("right", "chev")}</button>
  <button class="method stag" id="cUsb" ${sup.usb ? "" : "disabled"}><span class="squircle blue">${ic("usb")}</span><span class="otx"><b>USB cable</b><small>${sup.usb ? "Laptop with a board plugged in" : "Laptop Chrome only"}</small></span>${ic("right", "chev")}</button>
  <details class="method sim stag" ${!sup.ble ? "open" : ""}><summary><span class="squircle violet">${ic("flask")}</span><span class="otx"><b>Simulator</b><small>No hardware: talk to the command centre's virtual mesh</small></span>${ic("right", "chev")}</summary>
    <label>Command centre address<input id="sBase" value="${esc(A.base)}" inputmode="url"></label>
    <label>Act as node</label><div class="seg" id="sNodeSeg">${["FIELD", "RESP", "RELAY", "HOSP", "PHARM"].map((n) => `<button class="${n === A.simNode ? "on" : ""}" data-node="${n}">${n}</button>`).join("")}</div>
    <button class="btn primary" id="cSim">${ic("play")}Connect simulator</button></details>
  <details class="card stag"><summary class="muted">Advanced</summary><label>Name of the command-centre node<input id="bHint" value="${esc(A.baseHint)}"></label><p class="note">Messages go directly to the node whose name contains this (gives a delivery receipt). If not found, they're broadcast on your private channel.</p></details>
  ${connected() ? `<button class="btn ghost" id="cOff">Disconnect</button>` : ""}
  <p class="err" id="cErr"></p></div>`;
};

// ---------------- patient
screens.home_patient = () => {
  const active = A.cases.slice(-1)[0], st = active ? caseState(active.id) : null, alert = A.alerts[0];
  const ALV = { WARN: ["warn", "amber"], INFO: ["megaphone", "sky"], EVAC: ["siren", "red"] };
  const first = A.profile?.name ? esc(A.profile.name.split(" ")[0]) : "";
  const hour = new Date().getHours(), greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const path = link.kind === "sim" ? [link.nodeName, "Mesh", "Base"] : [link.nodeName ? link.nodeName.slice(0, 8) : "Node", "Mesh", "Base"];
  const tiles = [["med", "pill", "Medication", "Refill or delivery", "amber"], ["where", "hospital", "Where to go", "Best open site", "blue"], ["firstaid", "heartpulse", "First aid", "Offline guides", "red"], ["safe", "safe", "I'm safe", "Check in", "green"], ["block", "warn", "Report hazard", "Flood, debris", "amber"], ["log", "msgs", "Radio log", A.feed.length + " messages", "violet"]];
  return `${hdrLarge(first ? `${greet},<br>${first}` : greet, connected() ? "You're on the MedMesh network. Help is a hold away." : "Connect to a MedMesh node to send requests.")}
  <div class="pad tight">
    ${alert ? `<button class="alertbar ${(ALV[alert.level] || ALV.INFO)[1]} stag" data-go="alerts"><span class="aico">${ic((ALV[alert.level] || ALV.INFO)[0])}</span><span class="otx"><b>${alert.level === "EVAC" ? "EVACUATION ORDER" : alert.level === "WARN" ? "Warning · command centre" : "Update · command centre"}</b><small>${esc(alert.text)}</small></span>${ic("right", "chev")}</button>` : ""}
    ${active ? activeCard(active, st) : ""}
    <div class="sosbox stag ${active ? "compact" : ""}">
      <button class="sosbtn" id="sosHold" aria-label="Hold for emergency help">
        <svg class="ring" viewBox="0 0 120 120"><circle class="rbg" cx="60" cy="60" r="56"/><circle class="rfg" cx="60" cy="60" r="56"/></svg>
        <span class="sosin">${ic("siren", "", 2.2)}<b>SOS</b><small id="sosHint">Hold for help</small></span>
      </button>
      ${active ? "" : `<p class="soscap">Press and hold for a medical emergency.<br><span class="muted">8 quick questions · no signal needed</span></p>`}
    </div>
    <div class="meshcard stag ${connected() ? "" : "off"}" data-go="connect"><div class="row"><span class="eyebrow nm">Mesh route</span><span class="sp"></span><span class="small ${connected() ? "okc" : "muted"}">${connected() ? "Live" : "Tap to connect"}</span></div>${meshStrip(path, connected())}</div>
    <div class="tiles">${tiles.map(([g, i, t, s, tone]) => `<button class="tile stag" data-go="${g}"><span class="squircle ${tone}">${ic(i)}</span><b>${t}</b><small>${s}</small></button>`).join("")}</div>
    ${A.inbox.filter((m) => m.t !== "H").slice(0, 3).map(inboxCard).join("")}
  </div>`;
};
function activeCard(c, st) {
  const steps = ["sending", "received", "coming", "onboard"], idx = Math.max(0, steps.indexOf(st.phase === "wait" ? "received" : st.phase));
  return `<button class="activecase stag tri-${TRI[c.tri][1]}" data-track="${c.id}">
    <div class="row">${triPill(c.tri)}<span class="small muted">${ic(CMP[c.complaint][0], "sm")} ${CMP[c.complaint][1]}</span><span class="sp"></span><span class="live"><i></i>LIVE</span></div>
    <div class="acmain"><div><b>${st.head}</b><small>${st.eta ? st.etaLabel : st.sub || "Report " + esc(c.id)}</small></div>${st.eta ? `<div class="bigeta" id="homeEta">${st.eta}</div>` : `<i class="spin lg"></i>`}</div>
    <div class="phasebar">${steps.map((s, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</div>
    <div class="trackrow">${ic("map", "sm")} Track on map ${ic("right", "sm")}</div></button>`;
}
// summary of a reported case for home + tracking (works over the mesh from H| updates alone)
function caseState(id) {
  const ups = A.inbox.filter((m) => m.t === "H" && m.f[0] === id), last = ups[0], s = A.sent[id];
  const hospName = (() => { for (const u of ups) { const n = Object.values(HOSPITALS).find((h) => (u.f[3] || "").includes(h)); if (n) return n; } return null; })();
  const out = { head: "Sending your report…", sub: "", eta: null, etaLabel: "", hosp: hospName, phase: "sending" };
  if (s?.state === "failed") return { ...out, head: "Not sent: tap to retry", sub: s.error || "", phase: "failed" };
  if (s?.state === "received" || s?.state === "delivered") Object.assign(out, { head: "Received by command centre", sub: "Assigning an ambulance…", phase: "received" });
  if (last) {
    const mins = Number(last.f[2]) || 0, end = last.at + mins * 60000, left = Math.max(0, end - Date.now());
    const mm = String(Math.floor(left / 60000)).padStart(2, "0"), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    if (last.f[1] === "AMB") Object.assign(out, { head: "Ambulance on the way", eta: mins ? `${mm}:${ss}` : null, etaLabel: "until it reaches you", phase: "coming" });
    if (last.f[1] === "RR") Object.assign(out, { head: "Route changed · still coming", eta: mins ? `${mm}:${ss}` : null, etaLabel: "to " + (hospName || "hospital"), phase: "coming" });
    if (last.f[1] === "PK") Object.assign(out, { head: "With paramedics", eta: mins ? `${mm}:${ss}` : null, etaLabel: "to " + (hospName || "hospital"), phase: "onboard" });
    if (last.f[1] === "WAIT") Object.assign(out, { head: "Request received", sub: last.f[3] || "", phase: "wait" });
  }
  return out;
}
function inboxCard(m) {
  const [t, f] = [m.t, m.f];
  if (t === "H") {
    const head = { AMB: "Help is coming", RR: "Route changed", PK: "Paramedics are with the patient", WAIT: "Request received" }[f[1]] || "Update";
    return `<div class="card upd">${ic({ AMB: "amb", RR: "route", PK: "check" }[f[1]] || "info", "uic")}<div><b>${head}</b>${f[2] && f[2] !== "0" ? `<div class="eta">ETA <b>${esc(f[2])} min</b></div>` : ""}<p>${esc(f[3] || "")}</p></div></div>`;
  }
  if (t === "MA") return `<div class="card upd ${f[1] === "NONE" ? "warnc" : ""}">${ic("pill", "uic")}<div><b>${f[1] === "NONE" ? "Not available nearby" : "Medication sorted"}</b><p>${esc(f[4] || "")}</p></div></div>`;
  if (t === "W") return `<div class="card upd">${ic("hospital", "uic")}<div><b>Go to ${esc(f[3] || f[1])}</b>${f[2] && f[2] !== "0" ? `<div class="eta"><b>${esc(f[2])} min</b> by road</div>` : ""}${f[4] ? `<p class="mono small">via ${esc(f[4].replace(/>/g, " → "))}</p>` : ""}${HOSP_LL[f[1]] ? `<button class="btn sm" data-navw="${esc(f[1])}|${esc(f[4] || "")}">${ic("nav")}Show route</button>` : ""}</div></div>`;
  return "";
}

// Emergency questionnaire (START triage), one question per screen
const Q_STEPS = ["count", "walk", "breathing", "responds", "bleeding", "complaint", "age", "mid", "where", "review"];
function newQ() { return { id: rid(), step: 0, count: null, walk: null, breathing: null, responds: null, bleeding: null, complaint: null, age: null, mid: "", extras: {}, loc: null, locLabel: "" }; }
function triage(q) {
  if (q.walk) return 3;
  if (q.breathing === "none") return 4;
  if (q.breathing === "fast" || q.bleeding || q.responds === false) return 1;
  return 2;
}
function liveTri(q) {
  if (q.walk === true) return 3;
  if (q.breathing === "none") return 4;
  if (q.breathing === "fast" || q.bleeding === true || q.responds === false) return 1;
  if (q.bleeding === false) return 2;
  return 0;
}
screens.emergency = () => {
  const q = A.q || (A.q = newQ());
  const step = Q_STEPS[q.step], N = Q_STEPS.length, lt = liveTri(q);
  const head = `<header class="hdr qhdr"><button class="iconbtn" ${q.step ? `id="qBack"` : `data-back="home"`} aria-label="Back">${ic(q.step ? "left" : "x")}</button>
    <div class="segs">${Q_STEPS.map((_, i) => `<i class="${i < q.step ? "done" : i === q.step ? "cur" : ""}"></i>`).join("")}</div>
    ${lt ? triPill(lt) : `<span class="tri ghost">TRIAGE</span>`}</header><div class="pad qpad">`;
  const ask = (eyebrow, title, opts, sub = "") => `${head}<div class="eyebrow">${eyebrow}</div><h2 class="qh">${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ""}<div class="opts" data-q="${step}">${opts}</div></div>`;
  switch (step) {
    case "count": return ask("Scene", "How many people are hurt?", opt("1", "One person", "", "", "user") + opt("3", "2 – 5 people", "", "", "users") + opt("6", "6 or more", "Mass-casualty: tell us now", "", "siren"));
    case "walk": return ask("Triage · 1 of 4", "Can the person walk?", opt("1", "Yes, they can walk", "", "", "walk") + opt("0", "No", "", "", "x"));
    case "breathing": return ask("Triage · 2 of 4", "Are they breathing?", opt("normal", "Yes, normally", "", "", "wind") + opt("fast", "Yes, but very fast", "More than one breath every 2 seconds", "", "pulse") + opt("none", "No / I can't tell", "Start CPR if you can: guide after sending", "danger", "stop"));
    case "responds": return ask("Triage · 3 of 4", "Do they respond to you?", opt("1", "Yes, they answer", "Follow simple instructions", "", "help") + opt("0", "No response", "", "danger", "eyeoff"));
    case "bleeding": return ask("Triage · 4 of 4", "Is there heavy bleeding?", opt("0", "No", "", "", "check") + opt("1", "Yes, heavy bleeding", "Press hard on the wound with a cloth", "danger", "drop"));
    case "complaint": return ask("What happened", "What's the main problem?", Object.entries(CMP).map(([k, [i, l]]) => opt(k, l, "", "", i)).join(""));
    case "age": return ask("Patient", "Age group", opt("C", "Child", "Under 16", "", "baby") + opt("A", "Adult", "", "", "user") + opt("S", "Senior", "65 and over", "", "users"));
    case "mid": return `${head}<div class="eyebrow">Medical ID</div><h2 class="qh">Who is the patient?</h2><p class="muted">Lets the hospital see blood group and allergies instantly. Only a 6-letter code goes over the air.</p>
      <div class="opts">
        ${A.profile ? `<button class="opt" id="qMine"><span class="oic">${ic("id")}</span><span class="otx"><b>It's me · ${esc(A.profile.name)}</b><small class="mono">${A.profile.id} · ${esc(A.profile.blood || "")}</small></span><span class="radio">${ic("check", "", 3)}</span></button>` : ""}
        <button class="opt" id="qScan"><span class="oic">${ic("qr")}</span><span class="otx"><b>Scan their MedMesh QR</b><small>From their phone screen</small></span><span class="radio">${ic("right")}</span></button>
      </div>
      <label>Or type the code from their lock-screen Medical ID<input id="qMid" class="codein" maxlength="6" value="${esc(q.mid)}" placeholder="MX4K9P" autocapitalize="characters" autocomplete="off"></label>
      <details class="card"><summary class="muted">No ID? Add what you know</summary>
      <label>Blood group</label><div class="seg wrap" id="qBG">${["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => `<button class="${(q.extras.BG || "") === b ? "on" : ""}" data-bg="${b}">${b || "?"}</button>`).join("")}</div>
      <label>Allergies</label><div class="seg wrap" id="qAL">${["", "PEN", "LATEX", "NUTS", "OTHER"].map((b) => `<button class="${(q.extras.AL || "") === b ? "on" : ""}" data-al="${b}">${{ "": "None known", PEN: "Penicillin", LATEX: "Latex", NUTS: "Nuts", OTHER: "Other" }[b]}</button>`).join("")}</div>
      <label>Conditions</label><div class="chips" id="qCX">${[["DM", "Diabetes"], ["HT", "Heart"], ["AS", "Asthma"], ["SZ", "Epilepsy"], ["BT", "Blood thinners"]].map(([k, v]) => `<button class="chip ${(q.extras.CX || "").includes(k) ? "on" : ""}" data-cx="${k}">${v}</button>`).join("")}</div></details>
      <button class="btn primary" id="qNext">Continue ${ic("right")}</button></div>`;
    case "where": return `${head}<div class="eyebrow">Location</div><h2 class="qh">Where are you?</h2>
      <button class="btn primary big" id="qGps">${ic("locate")}Use my phone's GPS</button>
      <div class="eyebrow">Or pick the place</div><div class="opts" data-q="where">${Object.keys(SITES).map((k) => opt(k, k === "FIELD" ? "Near this MedMesh node" : k, k === "FIELD" ? "The radio you're connected to" : "", "", k === "FIELD" ? "radio" : "building")).join("")}</div>
      <p class="err" id="qErr"></p></div>`;
    case "review": {
      const t = triage(q), [tn, tc] = TRI[t], txt = reportText(q), bytes = new TextEncoder().encode(txt).length;
      return `${head}<div class="tricard ${tc}"><small>START triage result</small><b>${tn}</b><span>${{ 1: "Life-threatening: fastest ambulance", 2: "Serious but stable", 3: "Walking wounded", 4: "Not breathing: start CPR now" }[t]}</span></div>
        <div class="card list">
          <div>${ic(CMP[q.complaint][0])}<span>Problem</span><b>${CMP[q.complaint][1]}</b></div>
          <div>${ic("users")}<span>People</span><b>${q.count === "1" ? "1" : q.count === "3" ? "2–5" : "6+"} · ${{ C: "Child", A: "Adult", S: "Senior" }[q.age]}</b></div>
          <div>${ic("pulse")}<span>Vitals</span><b>${q.walk ? "walks" : "can't walk"} · ${q.breathing} · ${q.responds ? "responds" : "unresponsive"}${q.bleeding ? " · bleeding" : ""}</b></div>
          <div>${ic("id")}<span>Medical ID</span><b class="${q.mid ? "mono" : ""}">${q.mid ? esc(q.mid) : Object.keys(q.extras).length ? Object.entries(q.extras).map(([k, v]) => `${k}:${esc(v)}`).join(" ") : "none"}</b></div>
          <div>${ic("pin")}<span>Location</span><b>${esc(q.locLabel)}</b></div></div>
        <div class="packet"><div class="row"><span class="eyebrow nm">Over the air</span><span class="sp"></span><span class="mono small">${bytes} / 200 bytes</span></div><div class="bytebar"><i style="width:${(bytes / 200) * 100}%"></i></div><code>${esc(txt)}</code></div>
        <div class="slider" id="slideSend"><div class="sfill"></div><span class="slabel">Slide to send for help</span><button class="knob" aria-label="Send for help">${ic("send", "", 2.4)}</button></div>
        <p class="note center">Or press Enter on the button for keyboards.</p></div>`;
    }
  }
};
function reportText(q) {
  const flags = `${q.walk ? 1 : 0}${{ normal: "N", fast: "F", none: "X" }[q.breathing]}${q.responds ? 1 : 0}${q.bleeding ? 1 : 0}`;
  const ex = Object.entries(q.extras).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(";");
  return `R|${q.id}|${triage(q)}|${q.complaint}|${q.age}|${q.count}|${flags}|${q.loc[0].toFixed(4)},${q.loc[1].toFixed(4)}|${q.mid}|${ex}`;
}

// transmission diagram: phone -> nodes -> command centre, lighting up as receipts arrive
function hopViz(s, assigned) {
  const path = s.path?.length ? s.path : ["Node", "Mesh", "BASE"];
  const names = ["Phone", ...path];
  const lvl = s.state === "failed" ? 0 : s.state === "sending" ? 0 : s.state === "sent" ? 1 : s.state === "delivered" ? names.length - 1 : names.length;
  const lit = s.state === "received" || assigned ? names.length : lvl;
  const n = names.length, W = 320, xs = names.map((_, i) => 22 + i * ((W - 44) / (n - 1)));
  const segs = xs.slice(1).map((x, i) => `<line x1="${xs[i]}" y1="40" x2="${x}" y2="40" class="hl ${i + 1 < lit ? "on" : ""}"/>`).join("");
  const cur = Math.min(Math.max(lit - 1, 0), n - 2);
  const pkt = lit < n && s.state !== "failed" ? `<circle r="5" class="hp"><animate attributeName="cx" from="${xs[cur]}" to="${xs[cur + 1]}" dur="0.9s" repeatCount="indefinite"/><animate attributeName="cy" values="40;40" dur="0.9s" repeatCount="indefinite"/></circle>` : "";
  const nodes = names.map((nm, i) => `<g class="hn ${i < lit ? "on" : ""} ${i === n - 1 ? "base" : ""}"><circle cx="${xs[i]}" cy="40" r="${i === 0 || i === n - 1 ? 13 : 10}"/>${i < lit ? `<path d="M${xs[i] - 4},40 l3,3 l6,-6" class="hk"/>` : ""}<text x="${xs[i]}" y="72">${esc(i === n - 1 ? "Command" : nm)}</text></g>`).join("");
  return `<svg class="hopviz" viewBox="0 0 ${W} 82">${segs}${pkt}${nodes}</svg>`;
}
screens.sent = () => {
  const q = A.lastQ, s = A.sent[q.id], upd = A.inbox.filter((m) => m.f[0] === q.id);
  const t = triage(q), [tn, tc] = TRI[t], assigned = upd.length > 0, ok = (x) => x ? "done" : "";
  const recv = s.state === "received" || assigned, mesh = ["delivered", "received"].includes(s.state) || assigned;
  return `${hdr("Help requested")}<div class="pad">
    <div class="sentcard ${tc}"><div class="row">${triPill(t)}<span class="sp"></span><span class="mono small">Report ${esc(q.id)}</span></div>
      <h2>${s.state === "failed" ? "Couldn't reach the mesh" : assigned ? "Help is assigned" : recv ? "Command centre has it" : "Sending across the mesh…"}</h2>
      ${hopViz(s, assigned)}
      ${s.path ? `<div class="pathline">${ic("route", "sm")} Path taken: <b class="mono">${esc(s.path.join(" → "))}</b></div>` : ""}</div>
    <div class="timeline">
      <div class="${s.state !== "failed" ? "done" : "fail"}"><i></i><b>Sent from this phone</b><small>${s.t}</small></div>
      <div class="${ok(mesh)}"><i></i><b>Hopped across the radio mesh</b><small>${s.path ? s.path.length + " nodes" : "LoRa, ~1 kbps"}</small></div>
      <div class="${ok(recv)}"><i></i><b>Received by command centre</b><small>Triage re-checked, hospital scored</small></div>
      <div class="${ok(assigned)}"><i></i><b>Ambulance assigned</b><small>${assigned ? esc(upd[upd.length - 1].f[3] || "") : "Waiting…"}</small></div></div>
    ${s.state === "failed" ? `<p class="err">${esc(s.error)}</p><button class="btn primary" id="retry">${ic("refresh")}Try again</button>` : ""}
    ${assigned ? `<button class="btn primary big" data-track="${q.id}">${ic("map")}Track the ambulance live</button>` : ""}
    <div class="card"><div class="eyebrow nm">While you wait</div><ol class="aid">${FIRST_AID[q.complaint].map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    ${q.breathing === "none" ? `<button class="btn danger" data-guide="cpr">${ic("heartpulse")}Start CPR guide</button>` : ""}</div>
    <button class="btn ghost" data-back="home">Back to home</button></div>`;
};

screens.med = () => {
  const m = A.mq || (A.mq = { id: rid(), item: null, urg: null, travel: null });
  const stage = !m.item ? 0 : !m.urg ? 1 : m.travel == null ? 2 : 3;
  const head = `${hdr("Medication", stage ? "med:back" : "home")}<div class="pad"><div class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i <= stage ? "on" : ""}"></i>`).join("")}</div>`;
  if (stage === 0) return `${head}<h2 class="qh">Which medication?</h2><div class="opts grid" data-m="item">${Object.entries(MEDS).filter(([k]) => k !== "ONEG").map(([k, v]) => opt(k, v, "", "", MED_IC[k])).join("")}</div></div>`;
  if (stage === 1) return `${head}<h2 class="qh">How urgent?</h2><div class="opts" data-m="urg">${opt("N", "I've run out now", "Pharmacy is asked first", "danger", "clock")}${opt("D", "Running out within 24 h", "", "", "timer")}${opt("3", "Within 3 days", "", "", "clock")}</div></div>`;
  if (stage === 2) return `${head}<h2 class="qh">Can you get to a pharmacy?</h2><div class="opts" data-m="travel">${opt("1", "Yes, I can pick it up", "", "", "walk")}${opt("0", "No, I need it delivered", "A responder brings it", "", "amb")}</div></div>`;
  const s = A.sent[m.id], reply = A.inbox.find((x) => x.f[0] === m.id);
  return `${head}<div class="card list">
      <div>${ic(MED_IC[m.item])}<span>Medicine</span><b>${MEDS[m.item]}</b></div>
      <div>${ic("clock")}<span>Urgency</span><b>${{ N: "Out now", D: "Within 24 h", 3: "Within 3 days" }[m.urg]}</b></div>
      <div>${ic(m.travel === "1" ? "walk" : "amb")}<span>Travel</span><b>${m.travel === "1" ? "Pick up" : "Delivery"}</b></div>
      ${A.profile ? `<div>${ic("id")}<span>Medical ID</span><b class="mono">${A.profile.id}</b></div>` : ""}</div>
    ${s ? `<div class="statusline">${tick(s.state)}${!reply && ["delivered", "received"].includes(s.state) ? `<span class="pill wait"><i class="spin"></i>Finding a pharmacy</span>` : ""}</div>` : `<button class="btn primary big" id="mSend">${ic("send")}Send request</button>`}
    ${reply ? inboxCard(reply) : ""}
    <p class="note">If it becomes an emergency (e.g. an asthma attack), use SOS instead.</p><button class="btn ghost" id="mNew">${s ? "New request" : "Start over"}</button></div>`;
};

screens.where = () => {
  const w = A.wq || (A.wq = { id: rid(), c: null });
  if (!w.c) return `${hdr("Where can I go?")}<div class="pad"><h2 class="qh">What do you need help with?</h2><p class="muted">For non-emergencies. The command centre picks the best open site you can reach by road.</p><div class="opts grid" data-w="c">${Object.entries(CMP).filter(([k]) => k !== "UN").map(([k, [i, l]]) => opt(k, l, "", "", i)).join("")}</div></div>`;
  const s = A.sent[w.id], reply = A.inbox.find((x) => x.f[0] === w.id);
  return `${hdr("Where can I go?", "where:back")}<div class="pad"><div class="card list"><div>${ic(CMP[w.c][0])}<span>Need</span><b>${CMP[w.c][1]}</b></div></div>
    ${s ? `<div class="statusline">${tick(s.state)}${!reply && ["delivered", "received"].includes(s.state) ? `<span class="pill wait"><i class="spin"></i>Scoring hospitals</span>` : ""}</div>` : `<button class="btn primary big" id="wSend">${ic("send")}Ask the command centre</button>`}
    ${reply ? inboxCard(reply) : ""}<button class="btn ghost" id="wNew">Ask something else</button></div>`;
};

screens.myid = () => {
  const p = A.profile;
  if (!p || A.editId) {
    const e = p || { id: "", name: "", age: "", sex: "", blood: "", allergies: [], conditions: [], meds: [], contact: "" };
    return `${p ? hdr("Edit Medical ID", "myid:cancel") : hdrLarge("Medical ID", "Opt-in. Fill this in before an emergency. Only your 6-letter ID travels over the mesh.")}<div class="pad">
      <button class="btn glow" id="pDemo">${ic("flask")}Use a sample profile · Arun Mehta</button>
      <div class="card form">
      <label>Full name<input id="pName" value="${esc(e.name)}" placeholder="Your name"></label>
      <div class="grid2"><label>Age<input id="pAge" inputmode="numeric" value="${esc(e.age)}"></label><label>Sex<select id="pSex">${["", "F", "M", "X"].map((s) => `<option ${e.sex === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
      <label>Blood group</label><div class="seg wrap" id="pBloodSeg">${["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => `<button class="${e.blood === b ? "on" : ""}" data-blood="${b}">${b}</button>`).join("")}</div>
      <label>Allergies<input id="pAll" value="${esc(e.allergies.join(", "))}" placeholder="Penicillin, nuts…"></label>
      <label>Conditions<input id="pCond" value="${esc(e.conditions.join(", "))}"></label><label>Medications<input id="pMeds" value="${esc(e.meds.join(", "))}"></label>
      <label>Emergency contact<input id="pContact" value="${esc(e.contact)}"></label></div>
      <button class="btn primary big" id="pSave">${ic("id")}Save & create my ID</button></div>`;
  }
  return `${hdrLarge("Medical ID", "Tap the card to show your QR code.")}<div class="pad">
    <div class="flip ${A.flipped ? "on" : ""}" id="idFlip"><div class="flipin">
      <div class="idcard front"><div class="row"><span class="brand sm"><span class="logo">${ic("heartpulse", "", 2.4)}</span>MedMesh</span><span class="sp"></span><span class="chipico"></span></div>
        <div class="mid">${esc(p.id)}</div>
        <div class="idname">${esc(p.name)}</div>
        <div class="idmeta"><div><small>Blood</small><b class="blood">${esc(p.blood || "?")}</b></div><div><small>Age</small><b>${esc(p.age)}${esc(p.sex)}</b></div><div><small>Allergies</small><b>${esc(p.allergies.join(", ") || "None")}</b></div></div></div>
      <div class="idcard back"><canvas id="qr"></canvas><small class="mono">MEDMESH:${esc(p.id)}</small></div></div></div>
    <div class="card list">
      <div>${ic("pulse")}<span>Conditions</span><b>${esc(p.conditions.join(", ") || "None")}</b></div>
      <div>${ic("pill")}<span>Medications</span><b>${esc(p.meds.join(", ") || "None")}</b></div>
      <div>${ic("phone")}<span>Contact</span><b>${esc(p.contact || "–")}</b></div></div>
    <div class="card tip">${ic("info", "uic")}<p class="small">Add <b class="mono">${esc(p.id)}</b> to your lock-screen Medical ID (iPhone: Health → Medical ID · Android: Settings → Safety & emergency) so a bystander can read it without unlocking.</p></div>
    <div class="grid2"><button class="btn" id="pSync">${ic("refresh")}Sync to base</button><button class="btn ghost" id="pEdit">Edit</button></div>
    <p class="note center" id="pSyncMsg">Sync while you still have internet or Wi-Fi.</p></div>`;
};

screens.scan = () => `${hdr("Scan Medical ID", "scan:cancel")}<div class="pad"><div class="scanbox"><video id="vid" playsinline muted></video><div class="frame"><i></i></div></div><p class="muted center" id="scanMsg">Point at the QR code on their MedMesh app.</p><button class="btn ghost" id="scanCancel">Cancel</button></div>`;

// ---------------- responder
screens.home_responder = () => {
  const jobs = [], seen = new Set();
  A.inbox.forEach((m) => { if (!seen.has(m.f[0]) && ["D", "T"].includes(m.t)) { seen.add(m.f[0]); jobs.push(m); } });
  const rr = (id) => A.inbox.find((m) => m.t === "RR" && m.f[0] === id && m.at > (A.inbox.find((x) => x.t === "D" && x.f[0] === id)?.at || 0));
  const active = jobs.filter((m) => m.t === "D" && A.jobState?.[m.f[0]] !== "DL").length;
  return `${hdrLarge("Dispatch", connected() ? "On duty. New jobs buzz this phone." : "Connect to a node to receive jobs.")}<div class="pad tight">
    <div class="statrow stag"><div><b>${active}</b><small>Active</small></div><div><b>${jobs.filter((m) => rr(m.f[0])).length}</b><small>Rerouted</small></div><div><b>${Object.values(A.jobState || {}).filter((x) => x === "DL").length}</b><small>Delivered</small></div></div>
    ${jobs.length ? jobs.map((m) => {
      if (m.t === "T") return `<div class="job stag tri-yellow"><div class="row"><span class="tri yellow">DELIVERY</span><span class="sp"></span><span class="small muted">${ago(m.at)}</span></div><h3>${ic("box")} ${MEDS[m.f[2]] || m.f[2]}</h3><div class="legs"><div>${ic("store", "sm")}${PHARMACIES[m.f[1]] || m.f[1]}</div><div>${ic("pin", "sm")}${esc(m.f[3])}</div></div></div>`;
      const [id, tri, cmp, loc, h, eta, route] = m.f, r = rr(id), [, tc] = TRI[tri] || ["?", ""], st = A.jobState?.[id];
      const hosp = HOSPITALS[(r?.f[1]) || h] || h, stage = st === "DL" ? 2 : st === "PK" ? 1 : 0;
      return `<div class="job stag tri-${tc} ${st === "DL" ? "dim" : ""}"><div class="row">${triPill(tri)}<span class="mono small muted">${esc(id)}</span><span class="sp"></span><span class="small muted">${ago(m.at)}</span></div>
        <h3>${ic(CMP[cmp]?.[0] || "plus")} ${CMP[cmp]?.[1] || cmp}</h3>
        <div class="legs"><div>${ic("pin", "sm")}<span>Patient</span><b class="mono">${esc(loc)}</b></div><div>${ic("hospital", "sm")}<span>Hospital</span><b>${esc(hosp)}</b></div></div>
        <div class="etarow"><div><small>ETA</small><b>${esc(r ? r.f[2] + " min" : eta.replace("+", " + ") + " min")}</b></div><div class="via"><small>Via</small><span class="mono">${esc((r ? r.f[3] : route).replace(/>/g, " → "))}</span></div></div>
        ${r ? `<div class="reroute">${ic("route")}<div><b>Rerouted</b><small>Road ahead blocked or jammed. New route sent by command centre.</small></div></div>` : ""}
        <button class="btn primary" data-nav="${id}">${ic("nav")}Navigate</button>
        <div class="stepper3"><i style="width:${stage * 50}%"></i><button class="${stage >= 0 ? "on" : ""}" disabled>${ic("check", "sm")}Assigned</button><button class="${stage >= 1 ? "on" : ""}" data-job="${id}" data-s="PK">${stage >= 1 ? ic("check", "sm") : ""}Picked up</button><button class="${stage >= 2 ? "on" : ""}" data-job="${id}" data-s="DL">${stage >= 2 ? ic("check", "sm") : ""}Delivered</button></div></div>`;
    }).join("") : `<div class="emptyart stag"><div class="radar idle"><span></span><span></span><span></span><b>${ic("amb", "", 2)}</b></div><b>No assignments yet</b><p class="muted small">Listening on the mesh. Dispatches arrive here and buzz the phone.</p></div>`}</div>`;
};
screens.block = () => `${A.role === "responder" ? hdrLarge("Report a road", "The command centre reroutes every affected ambulance.") : hdr("Report a hazard")}<div class="pad tight">
  <label>Road</label><div class="roadpick"><select id="bRoad">${ROADS.map((r) => `<option ${A.lastRoad === r ? "selected" : ""}>${r}</option>`).join("")}</select>${ic("right", "chev")}</div>
  <div class="eyebrow">What's wrong?</div>
  <div class="hazards" data-b="reason">${[["FLOOD", "waves", "Flooded", "sky"], ["DEBRIS", "tree", "Debris / trees", "green"], ["FIRE", "flame", "Fire", "red"], ["POWER", "zap", "Power line down", "amber"], ["ACCIDENT", "car", "Accident", "violet"], ["SLOW", "gauge", "Slow traffic", "blue"]].map(([k, i, l, tone]) => `<button class="hz stag" data-v="${k}"><span class="squircle ${tone}">${ic(i)}</span><b>${l}</b><small>${k === "SLOW" ? "Still passable" : "Road closed"}</small></button>`).join("")}</div>
  <button class="btn" id="bFlood">${ic("waves")}This whole area is flooded</button>
  <p class="note">Blocked roads are removed from the offline map; slow roads count 3× slower.</p></div>`;

// ---------------- hospital
function ring(v, max, color, label) {
  const R = 46, C = 2 * Math.PI * R, p = Math.min(1, v / max);
  return `<div class="gauge"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R}" class="gbg"/><circle cx="55" cy="55" r="${R}" class="gfg" style="stroke:${color};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/></svg><div><b>${v}</b><small>${label}</small></div></div>`;
}
screens.home_hospital = () => {
  const h = A.hospital || (A.hospital = store.get("hosp_" + A.ref, { ...(HOSP_DEFAULT[A.ref] || { free: 4, icu: 1, caps: "CT" }), open: true }));
  const inc = A.inbox.filter((m) => m.t === "I"), sa = A.inbox.filter((m) => m.t === "SA");
  const step = (k, v) => `<div class="stepper"><button data-hs="${k}" data-d="-1">${ic("minus")}</button><span>${v}</span><button data-hs="${k}" data-d="1">${ic("plus")}</button></div>`;
  const sentC = A.sent[A.lastC];
  return `${hdrLarge(esc(HOSPITALS[A.ref] || "Hospital"), `<span class="openchip ${h.open ? "on" : ""}">${h.open ? "Accepting patients" : "Closed to new patients"}</span>`)}<div class="pad tight">
    <div class="card capcard stag"><div class="row"><span class="eyebrow nm">Live capacity</span><span class="sp"></span><span class="small muted">${h.open ? "Open" : "Closed"}</span><button class="switch ${h.open ? "on" : ""}" id="hOpen" aria-label="Open"></button></div>
      <div class="gauges"><div>${ring(h.free, Math.max(12, h.free), "#34d399", "free beds")}${step("free", h.free)}</div><div>${ring(h.icu, Math.max(4, h.icu), "#38bdf8", "ICU free")}${step("icu", h.icu)}</div></div>
      <div class="eyebrow nm">Can treat</div><div class="capchips">${Object.entries(CAPS).map(([k, [v, i]]) => `<button class="cchip ${h.caps.includes(k) ? "on" : ""}" data-hc="${k}">${ic(i, "sm")}${v}</button>`).join("")}</div></div>
    ${inc.length ? `<div class="eyebrow">Incoming patients · ${inc.length}</div>` : `<div class="eyebrow">Incoming patients</div>`}
    ${inc.length ? inc.map((m) => { const [id, tri, cmp, age, eta, ex] = m.f, [, tc] = TRI[tri] || ["?", ""]; return `<div class="job stag tri-${tc}"><div class="row">${triPill(tri)}<span class="mono small muted">${esc(id)}</span><span class="sp"></span><span class="small muted">${ago(m.at)}</span></div><h3>${ic(CMP[cmp]?.[0] || "plus")} ${CMP[cmp]?.[1] || cmp} · ${{ C: "Child", A: "Adult", S: "Senior" }[age] || ""}</h3><div class="etarow"><div><small>ETA</small><b>${esc(String(eta).replace("+", " + "))} min</b></div><div class="via"><small>Medical ID</small><span>${esc((ex || "none").replace(/;/g, " · "))}</span></div></div><div class="note">${ic("info", "sm")} Full SBAR handoff and red flags on the command-centre screen.</div></div>`; }).join("") : `<div class="emptyart stag small"><b>${ic("bed", "", 1.8)}</b><p class="muted small">No ambulances heading here yet.</p></div>`}
    <div class="eyebrow">Request supplies</div><div class="card stag"><div class="grid2"><label>Item<select id="sItem">${Object.entries(MEDS).filter(([k]) => k !== "OTHER").map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><label>Quantity<input id="sQty" inputmode="numeric" value="10"></label></div><button class="btn" id="sSend">${ic("box")}Request from pharmacies</button>
    ${sa.map((m) => `<div class="upd small">${ic("check", "sm")} Allocated: ${esc(m.f[1].split(",").map((x) => x.replace(":", " × ")).join(", ") || "none")} ${m.f[2] !== "short:0" ? `<span class="warn">(${esc(m.f[2])})</span>` : ""}</div>`).join("")}</div>
    <div class="spacer"></div></div>
    <div class="dock ${A.hDirty ? "dirty" : ""}"><div><b>${A.hDirty ? "Changes not sent" : sentC ? "Command centre up to date" : "Send your numbers"}</b><small>${A.hDirty ? "Beds, ICU or services changed" : sentC ? sentC.t : "Updates the hospital scoring live"}</small></div><button class="btn primary" id="hSend">${ic("send")}${sentC?.state === "sending" ? "Sending" : "Send"}</button></div>`;
};

// ---------------- pharmacy
screens.home_pharmacy = () => {
  const p = A.pharmacy || (A.pharmacy = store.get("ph_" + A.ref, { open: A.ref !== "MVR", stock: { ...(PHARM_DEFAULT[A.ref] || { INSULIN: 10, INHALER: 10, EPIPEN: 5, HEART: 10, SEIZURE: 5, BP: 10 }) } }));
  const reqs = A.inbox.filter((m) => m.t === "MR"), sups = A.inbox.filter((m) => m.t === "SR");
  const sentP = A.sent[A.lastP], pending = reqs.filter((m) => m.state === "new").length;
  return `${hdrLarge(esc(PHARMACIES[A.ref] || "Pharmacy"), `<span class="openchip ${p.open ? "on" : ""}">${p.open ? "Open" : "Closed"}</span>${pending ? ` <span class="openchip warnc">${pending} waiting</span>` : ""}`)}<div class="pad tight">
    <div class="eyebrow">Requests</div>
    ${reqs.length ? reqs.map((m) => { const [id, item, urg, travel, mid] = m.f; return `<div class="job stag tri-${urg === "N" ? "red" : "yellow"}"><div class="row"><span class="tri ${urg === "N" ? "red" : "yellow"}">${urg === "N" ? "OUT NOW" : urg === "D" ? "24 H" : "3 DAYS"}</span><span class="mono small muted">${esc(id)}</span><span class="sp"></span><span class="small muted">${ago(m.at)}</span></div>
      <h3>${ic(MED_IC[item] || "pill")} ${MEDS[item] || item}</h3><div class="legs"><div>${ic(travel === "1" ? "walk" : "amb", "sm")}<span>${travel === "1" ? "Patient picks up" : "Needs delivery"}</span></div>${mid ? `<div>${ic("id", "sm")}<span>Medical ID</span><b class="mono">${esc(mid)}</b></div>` : ""}<div>${ic("box", "sm")}<span>In stock</span><b>${p.stock[item] ?? 0}</b></div></div>
      ${m.state === "new" ? `<div class="grid2"><button class="btn ghost" data-pa="${id}" data-ok="NO">${ic("x")}Decline</button><button class="btn primary" data-pa="${id}" data-ok="OK">${ic("check")}Accept · 30 min</button></div>` : `<div class="upd small">${m.state === "OK" ? ic("check", "sm") + " Accepted · patient notified" : ic("route", "sm") + " Declined · routed to another pharmacy"}</div>`}</div>`; }).join("") : `<div class="emptyart stag small"><b>${ic("pill", "", 1.8)}</b><p class="muted small">No medicine requests yet.</p></div>`}
    ${sups.map((m) => `<div class="job stag tri-blue"><div class="row"><span class="tri blue">HOSPITAL</span><span class="sp"></span><span class="small muted">${ago(m.at)}</span></div><h3>${ic("box")} ${esc(m.f[3])} × ${MEDS[m.f[2]] || m.f[2]}</h3><p class="small muted">For ${esc(HOSPITALS[m.f[1]] || m.f[1])}: allocated from your stock.</p></div>`).join("")}
    <div class="eyebrow">Stock</div><div class="card stag"><div class="row"><b>Status</b><span class="sp"></span><span class="small muted">${p.open ? "Open" : "Closed"}</span><button class="switch ${p.open ? "on" : ""}" id="pOpen" aria-label="Open"></button></div>
    ${Object.entries(p.stock).map(([k, v]) => `<div class="stockrow"><span class="squircle xs ${v < 5 ? "red" : "amber"}">${ic(MED_IC[k] || "pill")}</span><div class="sinfo"><b>${MEDS[k]}</b><div class="sbar"><i class="${v < 5 ? "low" : ""}" style="width:${Math.min(100, (v / 40) * 100)}%"></i></div></div><div class="stepper"><button data-ps="${k}" data-d="-1">${ic("minus")}</button><span>${v}</span><button data-ps="${k}" data-d="1">${ic("plus")}</button></div></div>`).join("")}</div>
    <div class="spacer"></div></div>
    <div class="dock ${A.pDirty ? "dirty" : ""}"><div><b>${A.pDirty ? "Changes not sent" : sentP ? "Command centre up to date" : "Share your stock"}</b><small>${A.pDirty ? "Stock or status changed" : sentP ? sentP.t : "Patients get routed to you"}</small></div><button class="btn primary" id="pSend">${ic("send")}Send</button></div>`;
};

// ---------------- live tracking
screens.track = () => {
  const c = A.cases.find((x) => x.id === A.trackId) || A.cases.slice(-1)[0];
  return `${hdr("Live tracking")}<div class="navmap tall"><canvas id="trackc"></canvas><div id="trackBadge" class="navbadge"></div></div>
  <div class="sheet"><span class="grab"></span><div id="trackInfo">${trackInfo(c)}</div></div>`;
};
function trackInfo(c) {
  if (!c) return `<div class="empty">No active report.</div>`;
  const st = caseState(c.id), d = A.trackData;
  const steps = [["Report sent", true], ["Received by command centre", ["received", "coming", "onboard", "wait"].includes(st.phase)], ["Ambulance assigned", ["coming", "onboard"].includes(st.phase)], ["Paramedics with patient", st.phase === "onboard" || d?.status === "picked_up"], ["Arrived at hospital", d?.status === "delivered"]];
  return `<div class="row">${triPill(c.tri)}<span class="small muted">${CMP[c.complaint]?.[1] || ""}</span><span class="sp"></span><span class="mono small muted">${esc(c.id)}</span></div>
    <h2 class="trackh">${st.head}</h2>
    ${d?.amb ? `<div class="ambrow"><span class="squircle green">${ic("amb")}</span><div><b>${d.amb.kmh != null ? d.amb.kmh + " km/h" : "Moving"}</b><small>on ${esc(d.amb.road || "the way")}</small></div><span class="sp"></span>${d.hospital ? `<div class="right"><small>Going to</small><b>${esc(d.hospital.name)}</b></div>` : ""}</div>` : st.hosp ? `<div class="ambrow"><span class="squircle blue">${ic("hospital")}</span><div><small>Going to</small><b>${esc(st.hosp)}</b></div></div>` : ""}
    <div class="timeline">${steps.map(([t, ok]) => `<div class="${ok ? "done" : ""}"><i></i><b>${t}</b></div>`).join("")}</div>
    ${link.kind !== "sim" ? `<p class="note">Over the mesh you get ETA updates as messages. The live ambulance dot appears in simulator or on-site Wi-Fi mode.</p>` : ""}
    <div class="card"><div class="eyebrow nm">While you wait</div><ol class="aid">${FIRST_AID[c.complaint].map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    <button class="btn" data-go="firstaid">${ic("heartpulse")}First-aid guides</button></div>
    <a class="btn ghost" href="tel:911">${ic("phone")}If you get any signal, call 911</a>`;
}
async function openTrack(id) {
  A.trackMap = null; A.trackId = id; A.trackData = null; A.dir = "fwd"; A.screen = "track"; render(); window.scrollTo(0, 0);
  const geo = await loadArea(); if (!geo || !$("#trackc")) return;
  A.trackMap = new MedMap($("#trackc")); A.trackMap.setData(geo);
  updateTrack(true);
  clearInterval(A.trackTimer); A.trackTimer = setInterval(() => { if (A.screen !== "track") return clearInterval(A.trackTimer); updateTrack(false); }, 2000);
}
async function updateTrack(fit) {
  const c = A.cases.find((x) => x.id === A.trackId); if (!c || !A.trackMap) return;
  if (link.kind === "sim") { try { const d = await (await fetch(`${link.base}/api/track/${c.id}`)).json(); if (d.ok) A.trackData = d; } catch (e) {} }
  const d = A.trackData, st = caseState(c.id);
  const hosp = d?.hospital ? [d.hospital.lat, d.hospital.lon] : st.hosp ? HOSP_LL[Object.keys(HOSPITALS).find((k) => HOSPITALS[k] === st.hosp)] : null;
  const markers = [{ kind: "me", lat: c.loc[0], lon: c.loc[1], label: "You", always: true }];
  if (hosp) markers.push({ kind: "hospital", lat: hosp[0], lon: hosp[1], color: "#2563eb", label: d?.hospital?.name || st.hosp, always: true });
  if (d?.amb) markers.push({ kind: "ambulance", lat: d.amb.lat, lon: d.amb.lon, color: "#34d399", label: d.amb.kmh != null ? d.amb.kmh + " km/h" : "Ambulance", always: true });
  const routes = [];
  if (d?.pickup && d.status === "dispatched") routes.push({ coords: d.pickup, color: "#38bdf8", width: 6, flow: true });
  if (d?.route) routes.push({ coords: d.route, color: "#3b82f6", width: 6, alpha: d.status === "dispatched" ? .55 : 1, flow: d.status !== "dispatched" });
  A.trackMap.setOverlay({ routes, markers });
  if (fit) A.trackMap.fit([c.loc, ...(hosp ? [hosp] : []), ...(d?.pickup || []), ...(d?.route || [])]);
  const badge = $("#trackBadge");
  if (badge) badge.innerHTML = st.eta ? `<b>${st.eta}</b><small>${st.etaLabel}</small>` : `<b class="sm">${st.head}</b>`;
  const info = $("#trackInfo"); if (info) { info.innerHTML = trackInfo(c); bind("track"); }
}

// ---------------- first aid (works fully offline)
screens.firstaid = () => `${hdrLarge("First aid", "Step-by-step guides that work with no signal.")}<div class="pad tight">
  <div class="guides">${GUIDES.map((g) => `<button class="gcard stag ${g.id === "cpr" ? "cprhero" : ""}" data-guide="${g.id}"><span class="squircle ${g.id === "cpr" || g.id === "bleed" ? "red" : g.id === "burn" ? "amber" : g.id === "cold" ? "sky" : "violet"}">${ic(GUIDE_IC[g.id] || "plus")}</span><span class="otx"><b>${g.title}</b><small>${g.when}</small></span>${g.id === "cpr" ? `<span class="pill bad">${ic("play")}Beat</span>` : ""}</button>`).join("")}</div>
  <p class="note">General first-aid guidance, not a substitute for training or professional care.</p></div>`;
screens.guide = () => {
  const g = GUIDES.find((x) => x.id === A.guideId) || GUIDES[0];
  const done = (A.gdone = A.gdone || {})[g.id] || [], pct = Math.round((done.length / g.steps.length) * 100);
  return `${hdr(g.title, "firstaid")}<div class="pad"><div class="guidehead"><span class="squircle lg red">${ic(GUIDE_IC[g.id] || "plus")}</span><div><b>${g.title}</b><small>${g.when}</small></div></div>
    ${g.cpr ? `<div class="cprbox"><div class="cprbeat ${A.metro?.running ? "run" : ""}" id="cprBeat"><span id="cprNum">${A.metro?.running ? (A.metro.count % 30) || 30 : "110"}</span><small>${A.metro?.running ? "of 30" : "beats / min"}</small></div><div class="cprcount" id="cprCount">${A.metro?.running ? "Push to the beat" : "Hands-only CPR beat with sound + vibration"}</div>
      <button class="btn ${A.metro?.running ? "" : "danger"}" id="cprBtn">${A.metro?.running ? ic("square") + "Stop beat" : ic("play") + "Start CPR beat"}</button></div>` : ""}
    <div class="row"><span class="eyebrow nm">Steps</span><span class="sp"></span><span class="small muted">${done.length}/${g.steps.length} done</span></div><div class="bytebar"><i style="width:${pct}%"></i></div>
    <ol class="gsteps">${g.steps.map((s, i) => `<li class="${done.includes(i) ? "done" : ""}" data-gs="${i}"><span class="num">${done.includes(i) ? ic("check", "", 3) : i + 1}</span><span>${esc(s)}</span></li>`).join("")}</ol>
    <button class="btn danger" data-go="emergency">${ic("siren")}Send SOS</button></div>`;
};

// ---------------- I'm safe / need help (not urgent)
screens.safe = () => {
  const s = A.lastSafe && A.sent[A.lastSafe];
  return `${hdr("Check in")}<div class="pad"><h2 class="qh">Let your community know</h2>
  <p class="muted">Tells the command centre how you're doing. Only your name and location are sent.</p>
  <label>Your name<input id="safeName" value="${esc(A.profile?.name || store.get("safeName", ""))}" placeholder="e.g. Ishika S."></label>
  ${s ? `<div class="donebox ${s.text.split("|")[2] === "SAFE" ? "" : "amber"}"><span class="bigcheck">${ic(s.text.split("|")[2] === "SAFE" ? "check" : "help", "", 2.6)}</span><b>${s.text.split("|")[2] === "SAFE" ? "Marked safe" : "Help request sent"}</b>${tick(s.state)}</div>` : ""}
  <div class="safebtns"><button class="safebig green" data-safe="SAFE">${ic("safe", "", 2.2)}<b>I'm safe</b><small>No help needed</small></button>
  <button class="safebig amber" data-safe="NEED">${ic("help", "", 2.2)}<b>I need help</b><small>Not urgent: water, medicine, shelter</small></button></div></div>`;
};

// ---------------- nearby hospitals, pharmacies, shelters
screens.nearby = () => {
  const here = A.here || SITES.FIELD, f = A.nearFilter || "all";
  const list = PLACES.filter((p) => f === "all" || p.kind === f).map((p) => ({ ...p, d: distM(here, p.ll) })).sort((a, b) => a.d - b.d);
  const ico = { hospital: ["hospital", "blue"], pharmacy: ["pill", "amber"], shelter: ["home", "green"] };
  return `${hdrLarge("Nearby", A.here ? "Distances from your GPS location." : "Distances from this MedMesh node.")}
  <div class="minimap stag"><canvas id="nearc"></canvas></div>
  <div class="pad tight"><div class="seg" id="nearSeg">${[["all", "All"], ["hospital", "Hospitals"], ["pharmacy", "Pharmacies"], ["shelter", "Shelters"]].map(([k, v]) => `<button class="${f === k ? "on" : ""}" data-near="${k}">${v}</button>`).join("")}</div>
  ${list.map((p) => `<button class="placecard stag" data-place="${p.id}"><span class="squircle ${ico[p.kind][1]}">${ic(ico[p.kind][0])}</span><span class="otx"><b>${esc(p.name)}</b><small>${esc(p.note)}</small></span><span class="dist">${p.d >= 1000 ? (p.d / 1000).toFixed(1) + "<small>km</small>" : Math.round(p.d) + "<small>m</small>"}</span></button>`).join("")}</div>`;
};

// ---------------- alerts from the command centre
screens.alerts = () => {
  const L = { WARN: ["warn", "Warning", "amber"], INFO: ["megaphone", "Update", "sky"], EVAC: ["siren", "Evacuate", "red"] };
  return `${hdrLarge("Alerts", "Broadcasts from the command centre to every phone on the mesh.")}<div class="pad tight">
  ${A.alerts.map((a) => { const [i, n, tone] = L[a.level] || L.INFO; return `<div class="alertcard stag ${tone}"><span class="squircle ${tone}">${ic(i)}</span><div><div class="row"><b>${n}</b><span class="sp"></span><small class="muted">${ago(a.at)}</small></div><p>${esc(a.text)}</p></div></div>`; }).join("") || `<div class="emptyart stag"><b>${ic("bell", "", 1.8)}</b><b>All quiet</b><p class="muted small">Alerts buzz this phone the moment they arrive.</p></div>`}</div>`;
};

// ---------------- offline navigation map (responder + patient "where")
screens.nav = () => {
  const n = A.nav;
  return `${hdr("Navigation", "home")}<div class="navmap"><canvas id="navc"></canvas>${n.eta ? `<div class="navbadge"><b>${esc(n.eta)}</b><small>${esc(n.dest)}</small></div>` : ""}</div>
  <div class="sheet"><span class="grab"></span>${n.err ? `<p class="err">${esc(n.err)}</p>` : ""}
  ${n.legs.map((L, li) => `<div class="eyebrow ${li ? "" : "nm"}">${esc(L.title)}${L.dist ? " · " + (L.dist / 1000).toFixed(1) + " km" : ""}</div><div class="navsteps">${L.steps.map((s, i) => `<div><span class="turn">${ic(i === 0 ? "up" : "turn")}</span><span>${i === 0 ? "Head along" : "Then"} <b>${esc(s.road)}</b></span><span class="mono small">${s.dist >= 1000 ? (s.dist / 1000).toFixed(1) + " km" : s.dist + " m"}</span></div>`).join("")}<div><span class="turn end">${ic("flag")}</span><span>Arrive: <b>${esc(L.to_label || "destination")}</b></span><span></span></div></div>`).join("")}
  <p class="note">Map and routing run on this phone with no internet. If a road gets blocked, you'll get a reroute over the mesh.</p></div>`;
};
async function loadArea() {
  if (A.geo) return A.geo;
  try { A.geo = await (await fetch("area.json")).json(); } catch (e) {
    try { A.geo = await (await fetch(A.base.replace(/\/$/, "") + "/api/map")).json(); } catch (e2) { A.geo = null; }
  }
  return A.geo;
}
async function openNav({ legs, eta, dest }) {
  const geo = await loadArea();
  A.nav = { legs: [], eta, dest, err: geo ? "" : "Area map not available on this phone yet." };
  if (geo) legs.forEach((L) => { const r = routeLocal(geo, L.from, L.to, L.roads); if (r) A.nav.legs.push({ ...L, steps: r.steps, coords: r.coords, dist: r.steps.reduce((a, s) => a + s.dist, 0) }); });
  A.dir = "fwd"; A.screen = "nav"; render(); window.scrollTo(0, 0);
  if (!geo) return;
  const map = new MedMap($("#navc"));
  map.setData(geo);
  const markers = legs.flatMap((L, i) => [i === 0 ? { kind: "me", lat: L.from[0], lon: L.from[1], label: "You", always: true } : null, { kind: L.kind || "pin", lat: L.to[0], lon: L.to[1], color: L.kind === "hospital" ? "#2563eb" : "#ef4444", label: L.to_label || L.to, always: true }]).filter(Boolean);
  const routes = A.nav.legs.map((L, i) => ({ coords: L.coords, color: i === 0 && legs.length > 1 ? "#38bdf8" : "#3b82f6", width: 7, flow: true }));
  map.setOverlay({ routes, markers });
  map.fit(A.nav.legs.flatMap((L) => L.coords));
  A.navMap = map;
}
function myPos() {
  return new Promise((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition((p) => res([p.coords.latitude, p.coords.longitude]), () => res(null), { timeout: 5000, maximumAge: 30000 }); });
}

screens.log = () => `${hdrLarge("Radio log", "Every LoRa message this phone sent or received. Each is under 200 bytes.")}<div class="pad tight chat">
  ${A.feed.map((m) => { const t = m.text.split("|")[0]; return `<div class="bub ${m.dir}"><div class="bh">${ic(m.dir === "in" ? "tower" : "send", "sm")}<b>${MSG_NAME[t] || t}</b><span class="sp"></span><small>${m.t}</small></div><code>${esc(m.text)}</code><small class="bytes">${new TextEncoder().encode(m.text).length} B</small></div>`; }).join("") || `<div class="emptyart stag"><b>${ic("tower", "", 1.8)}</b><b>No traffic yet</b><p class="muted small">Messages appear here as they cross the mesh.</p></div>`}</div>`;

screens.settings = () => `${hdrLarge("Settings")}<div class="pad tight">
  <div class="group stag"><button data-go="connect">${ic("radio")}<span>Connection</span><small>${connected() ? esc(link.nodeName) + (link.kind === "sim" ? " · sim" : "") : "Offline"}</small>${ic("right", "chev")}</button>
  <button id="chRole">${ic(ROLE[A.role]?.[0] || "user")}<span>Role</span><small>${A.role ? ROLE[A.role][1] : "–"}${A.ref ? " · " + esc(A.ref) : ""}</small>${ic("right", "chev")}</button>
  ${A.role === "patient" ? `<button data-go="myid">${ic("id")}<span>Medical ID</span><small>${A.profile ? A.profile.id : "Not set"}</small>${ic("right", "chev")}</button>` : ""}
  <button data-go="log">${ic("msgs")}<span>Radio log</span><small>${A.feed.length}</small>${ic("right", "chev")}</button></div>
  <div class="group stag"><div class="gi">${ic("info")}<span>Build</span><small>MedMesh v4 · hackathon prototype</small></div><div class="gi">${ic("shield")}<span>Data</span><small>Simulated hospitals & pharmacies</small></div></div></div>`;

// ------------------------------------------------------------------ render + navigation
let lastKey = "", stopAerial = null;
function screenName() {
  let name = A.role ? A.screen : "role";
  if (A.role && ["hospital", "pharmacy"].includes(A.role) && !A.ref && name !== "role") name = "roleref";
  if (name === "home") name = "home_" + A.role;
  return name;
}
function render() {
  if (A.screen === "track" && A.trackMap && $("#trackc")) { updateTrack(false); return; } // don't rebuild the live map
  if (A.screen !== "track") A.trackMap = null;
  if (A.screen === "nav" && A.navMap && $("#navc")) return;
  const name = screenName();
  const sub = name === "emergency" ? A.q?.step : name === "med" ? JSON.stringify(A.mq && [!!A.mq.item, !!A.mq.urg, A.mq.travel != null]) : name === "where" ? !!A.wq?.c : name === "guide" ? A.guideId : name === "myid" ? !!A.editId + "" + !!A.profile : "";
  const key = name + ":" + sub, entering = key !== lastKey; lastKey = key;
  const tabbed = A.role && TABBED.includes(A.screen) && screens[name] && name !== "roleref";
  const y = window.scrollY;
  if (stopAerial) { stopAerial(); stopAerial = null; }
  $("#app").innerHTML = `<main class="view ${entering ? "enter " + A.dir : ""}">${(screens[name] || screens.home_patient)()}</main>${tabbed ? tabbar() : ""}`;
  document.body.classList.toggle("tabbed", !!tabbed);
  if (entering) window.scrollTo(0, 0); else window.scrollTo(0, y);
  bind(name);
  if (name === "role" && $("#a3d")) stopAerial = aerial3d($("#a3d"));
  if (name === "myid" && A.profile && !A.editId) QRCode.toCanvas($("#qr"), "MEDMESH:" + A.profile.id, { width: 220, margin: 1, color: { dark: "#05070f", light: "#ffffff" } });
  if (name === "nearby") drawNearby();
  if (name === "alerts") A.seenAlerts = A.alerts.length;
  A.dir = "fwd";
}
async function drawNearby() {
  const geo = await loadArea(), cv = $("#nearc"); if (!geo || !cv) return;
  const map = new MedMap(cv); map.setData(geo);
  const here = A.here || SITES.FIELD, f = A.nearFilter || "all";
  const pl = PLACES.filter((p) => f === "all" || p.kind === f);
  map.setOverlay({ routes: [], markers: [{ kind: "me", lat: here[0], lon: here[1], label: "You", always: true }, ...pl.map((p) => ({ kind: p.kind === "shelter" ? "pin" : p.kind, lat: p.ll[0], lon: p.ll[1], color: p.kind === "hospital" ? "#2563eb" : "#34d399", label: p.name.split(" ·")[0] }))] });
  map.fit([here, ...pl.map((p) => p.ll)]);
}
function go(s, dir = "fwd") {
  if (A.metro?.running && s !== "guide") A.metro.stop();
  A.trackMap = null; A.navMap = null; A.dir = dir; A.screen = s;
  if (s === "nearby" && !A.hereAsked) { A.hereAsked = true; myPos().then((p) => { if (p) { A.here = p; if (A.screen === "nearby") render(); } }); }
  if (s === "emergency") A.q = newQ();
  if (s === "med") A.mq = null;
  if (s === "where") A.wq = null;
  buzz(8); render();
}
function back(target) {
  if (target === "med:back") { const m = A.mq; if (m.travel != null && !A.sent[m.id]) m.travel = null; else if (m.urg) m.urg = null; else m.item = null; A.dir = "back"; return render(); }
  if (target === "where:back") { A.wq.c = null; A.dir = "back"; return render(); }
  if (target === "myid:cancel") { A.editId = false; A.dir = "back"; return render(); }
  if (target === "scan:cancel") { stopScan(); A.dir = "back"; A.screen = A.scanReturn || "home"; return render(); }
  if (target === "role") { A.role = null; store.set("role", null); A.dir = "back"; return render(); }
  go(target || "home", "back");
}

function bind(name) {
  $$("[data-go]").forEach((el) => (el.onclick = () => go(el.dataset.go)));
  $$("[data-tab]").forEach((el) => (el.onclick = () => { if (A.screen !== el.dataset.tab) go(el.dataset.tab); }));
  $$("[data-back]").forEach((el) => (el.onclick = () => back(el.dataset.back)));
  $$("[data-role]").forEach((el) => (el.onclick = () => { A.role = el.dataset.role; A.ref = ""; store.set("role", A.role); store.set("ref", ""); A.inbox = []; go(A.role === "patient" || A.role === "responder" ? "connect" : "home"); }));
  $$("[data-ref]").forEach((el) => (el.onclick = () => { A.ref = el.dataset.ref; store.set("ref", A.ref); A.hospital = null; A.pharmacy = null; go("connect"); }));
  const on = (id, fn) => { const e = $("#" + id); if (e) e.onclick = fn; };

  // connect
  const cerr = (e) => { const el = $("#cErr"); if (el) el.textContent = e.message || String(e); };
  const saveHint = () => { const h = $("#bHint"); if (h) { A.baseHint = h.value.trim() || "BASE"; store.set("baseHint", A.baseHint); } };
  $$("[data-node]").forEach((el) => (el.onclick = () => { A.simNode = el.dataset.node; $$("[data-node]").forEach((b) => b.classList.toggle("on", b === el)); buzz(6); }));
  on("cBle", async () => { saveHint(); try { await link.connectDevice("ble", A.baseHint); go("home"); } catch (e) { cerr(e); link.setStatus("disconnected"); } });
  on("cUsb", async () => { saveHint(); try { await link.connectDevice("usb", A.baseHint); go("home"); } catch (e) { cerr(e); link.setStatus("disconnected"); } });
  on("cSim", async () => { A.base = $("#sBase").value.trim(); store.set("base", A.base); store.set("simNode", A.simNode); try { await link.connectSim(A.base, A.simNode); setTimeout(() => go("home"), 650); } catch (e) { cerr(e); link.setStatus("disconnected"); } });
  on("cOff", async () => { await link.disconnect(); render(); });
  on("chRole", () => { A.role = null; store.set("role", null); A.dir = "back"; render(); });

  // hold-to-SOS
  const sos = $("#sosHold");
  if (sos) {
    const HOLD = 800, fg = sos.querySelector(".rfg"), C = 2 * Math.PI * 56, hint = $("#sosHint");
    fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C;
    let raf = 0, t0 = 0;
    const reset = () => { cancelAnimationFrame(raf); sos.classList.remove("holding"); fg.style.strokeDashoffset = C; t0 = 0; };
    sos.onpointerdown = (e) => {
      e.preventDefault(); t0 = performance.now(); sos.classList.add("holding"); let q = 0; buzz(10);
      const stepf = (t) => {
        const p = Math.min(1, (t - t0) / HOLD); fg.style.strokeDashoffset = C * (1 - p);
        const nq = Math.floor(p * 4); if (nq > q) { q = nq; buzz(12); }
        if (p >= 1) { buzz([60, 40, 140]); reset(); go("emergency"); return; }
        raf = requestAnimationFrame(stepf);
      };
      raf = requestAnimationFrame(stepf);
    };
    const up = () => { if (!t0) return; const held = performance.now() - t0; reset(); if (held < HOLD && hint) { hint.textContent = "Keep holding…"; sos.classList.add("nudge"); setTimeout(() => sos.classList.remove("nudge"), 400); } };
    sos.onpointerup = up; sos.onpointerleave = up; sos.onpointercancel = up;
    sos.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("emergency"); } };
    sos.oncontextmenu = (e) => e.preventDefault();
  }

  // emergency questionnaire
  const q = A.q;
  const next = () => { q.step++; A.dir = "fwd"; render(); };
  on("qBack", () => { q.step = Math.max(0, q.step - 1); A.dir = "back"; render(); });
  $$("[data-q] .opt").forEach((el) => (el.onclick = () => {
    const k = el.parentElement.dataset.q, v = el.dataset.v;
    if (k === "count") q.count = v;
    if (k === "walk") q.walk = v === "1";
    if (k === "breathing") q.breathing = v;
    if (k === "responds") q.responds = v === "1";
    if (k === "bleeding") q.bleeding = v === "1";
    if (k === "complaint") q.complaint = v;
    if (k === "age") q.age = v;
    if (k === "where") { q.loc = SITES[v]; q.locLabel = v === "FIELD" ? "Near this MedMesh node" : v; }
    el.classList.add("sel"); el.parentElement.classList.add("picked"); buzz(10);
    setTimeout(next, 200);
  }));
  on("qMine", () => { q.mid = A.profile.id; $("#qMine").classList.add("sel"); buzz(10); setTimeout(next, 200); });
  $$("[data-cx]").forEach((el) => (el.onclick = () => { const cx = new Set((q.extras.CX || "").split(",").filter(Boolean)); cx.has(el.dataset.cx) ? cx.delete(el.dataset.cx) : cx.add(el.dataset.cx); q.extras.CX = [...cx].join(","); el.classList.toggle("on"); buzz(6); }));
  $$("[data-bg]").forEach((el) => (el.onclick = () => { q.extras.BG = el.dataset.bg; $$("[data-bg]").forEach((b) => b.classList.toggle("on", b === el)); buzz(6); }));
  $$("[data-al]").forEach((el) => (el.onclick = () => { q.extras.AL = el.dataset.al; $$("[data-al]").forEach((b) => b.classList.toggle("on", b === el)); buzz(6); }));
  const midIn = $("#qMid"); if (midIn) midIn.oninput = () => { midIn.value = midIn.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); };
  on("qNext", () => { q.mid = ($("#qMid").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); Object.keys(q.extras).forEach((k) => !q.extras[k] && delete q.extras[k]); next(); });
  on("qScan", () => { A.scanReturn = "emergency"; A.screen = "scan"; render(); startScan(); });
  on("qGps", () => {
    if (!navigator.geolocation) return ($("#qErr").textContent = "No GPS available: pick the place instead.");
    $("#qGps").innerHTML = `<i class="spin"></i>Finding you…`;
    navigator.geolocation.getCurrentPosition((p) => { q.loc = [p.coords.latitude, p.coords.longitude]; q.locLabel = `GPS ${q.loc[0].toFixed(4)}, ${q.loc[1].toFixed(4)}`; next(); },
      () => { $("#qErr").textContent = "Couldn't get GPS: pick the place instead."; $("#qGps").innerHTML = ic("locate") + "Use my phone's GPS"; }, { enableHighAccuracy: true, timeout: 8000 });
  });
  const doSend = () => { A.lastQ = q; A.cases.push({ id: q.id, tri: triage(q), loc: q.loc, complaint: q.complaint }); A.dir = "fwd"; A.screen = "sent"; buzz([40, 30, 80]); send(reportText(q), "emergency"); };
  const sl = $("#slideSend");
  if (sl) {
    const knob = sl.querySelector(".knob"), fill = sl.querySelector(".sfill");
    let sx = 0, dx = 0, drag = false;
    const max = () => sl.clientWidth - knob.offsetWidth - 8;
    const set = (x) => { dx = Math.max(0, Math.min(max(), x)); knob.style.transform = `translateX(${dx}px)`; fill.style.width = dx + knob.offsetWidth / 2 + 8 + "px"; sl.style.setProperty("--p", dx / max()); };
    knob.onpointerdown = (e) => { drag = true; sx = e.clientX - dx; knob.setPointerCapture(e.pointerId); sl.classList.add("drag"); buzz(8); };
    knob.onpointermove = (e) => { if (drag) set(e.clientX - sx); };
    knob.onpointerup = () => { if (!drag) return; drag = false; sl.classList.remove("drag"); if (dx >= max() * 0.9) { set(max()); sl.classList.add("go"); doSend(); } else { knob.style.transition = fill.style.transition = "all .3s cubic-bezier(.2,.9,.3,1.2)"; set(0); setTimeout(() => { knob.style.transition = fill.style.transition = ""; }, 320); } };
    knob.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doSend(); } };
  }
  on("retry", () => send(reportText(A.lastQ), "emergency"));

  // medication / where
  $$("[data-m] .opt").forEach((el) => (el.onclick = () => { el.classList.add("sel"); buzz(10); setTimeout(() => { A.mq[el.parentElement.dataset.m] = el.dataset.v; render(); }, 180); }));
  on("mSend", () => { const m = A.mq; send(`M|${m.id}|${m.item}|${m.urg}|${m.travel}|${SITES.FIELD.join(",")}|${A.profile?.id || ""}`, "medication"); });
  on("mNew", () => go("med"));
  $$("[data-w] .opt").forEach((el) => (el.onclick = () => { el.classList.add("sel"); buzz(10); setTimeout(() => { A.wq.c = el.dataset.v; render(); }, 180); }));
  on("wSend", () => send(`Q|${A.wq.id}|${A.wq.c}|${SITES.FIELD.join(",")}`, "where"));
  on("wNew", () => go("where"));

  // medical ID
  $$("[data-blood]").forEach((el) => (el.onclick = () => { $$("[data-blood]").forEach((b) => b.classList.toggle("on", b === el)); A.pendingBlood = el.dataset.blood; buzz(6); }));
  on("pSave", () => {
    const list = (id) => $("#" + id).value.split(",").map((s) => s.trim()).filter(Boolean);
    const id = A.profile?.id || Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    A.profile = { id, name: $("#pName").value.trim() || "Me", age: $("#pAge").value, sex: $("#pSex").value, blood: A.pendingBlood || A.profile?.blood || "", allergies: list("pAll"), conditions: list("pCond"), meds: list("pMeds"), contact: $("#pContact").value };
    store.set("profile", A.profile); A.editId = false; toast("id", "Medical ID saved", "Your code is " + id, "green"); render();
  });
  on("pDemo", () => { A.profile = { id: "MX4K9P", name: "Arun Mehta", age: 61, sex: "M", blood: "O-", allergies: ["Penicillin"], conditions: ["Type 2 diabetes", "Atrial fibrillation"], meds: ["Warfarin", "Metformin"], contact: "Priya Mehta (daughter)" }; store.set("profile", A.profile); A.editId = false; render(); });
  on("pEdit", () => { A.editId = true; A.pendingBlood = A.profile?.blood; render(); });
  on("idFlip", () => { A.flipped = !A.flipped; $("#idFlip").classList.toggle("on", A.flipped); buzz(8); });
  on("pSync", async () => {
    const msg = $("#pSyncMsg");
    try { const r = await (await fetch(A.base.replace(/\/$/, "") + "/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(A.profile) })).json(); msg.textContent = r.ok ? "Synced. The command centre can look up your ID offline." : "Sync failed: " + r.error; if (r.ok) toast("check", "Synced to command centre", A.profile.id, "green"); }
    catch (e) { msg.textContent = "Couldn't reach the command centre (" + A.base + "). Sync when you're on its network."; }
  });
  on("scanCancel", () => back("scan:cancel"));

  // responder
  $$("[data-job]").forEach((el) => (el.onclick = () => { A.jobState = A.jobState || {}; A.jobState[el.dataset.job] = el.dataset.s; buzz(15); send(`U|${el.dataset.job}|${el.dataset.s}`, "status"); }));
  $$("[data-b] .hz").forEach((el) => (el.onclick = () => {
    const road = $("#bRoad").value; A.lastRoad = road; el.classList.add("sel"); buzz(15);
    if (el.dataset.v === "SLOW") send(`K|${road}|TRAFFIC`, "slow"); else send(`B|${road}|${el.dataset.v}`, "blocked");
    toast(el.dataset.v === "SLOW" ? "gauge" : "cone", el.dataset.v === "SLOW" ? "Slow traffic reported" : "Road reported closed", road, "sky");
    setTimeout(() => go("home", "back"), 350);
  }));
  on("bFlood", () => {
    const fire = (ll) => { send(`F|${ll[0].toFixed(4)},${ll[1].toFixed(4)}|400`, "flood"); toast("waves", "Flood zone reported", "400 m around you", "sky"); go("home", "back"); };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => fire([p.coords.latitude, p.coords.longitude]), () => fire(SITES.FIELD), { timeout: 6000 }); else fire(SITES.FIELD);
  });

  // patient extras
  $$("[data-track]").forEach((el) => (el.onclick = () => openTrack(el.dataset.track)));
  $$("[data-guide]").forEach((el) => (el.onclick = () => { A.guideId = el.dataset.guide; A.dir = "fwd"; A.screen = "guide"; render(); }));
  $$("[data-gs]").forEach((el) => (el.onclick = () => { const g = A.guideId || "cpr", i = Number(el.dataset.gs), d = (A.gdone[g] = A.gdone[g] || []); d.includes(i) ? d.splice(d.indexOf(i), 1) : d.push(i); buzz(8); render(); }));
  on("cprBtn", () => {
    A.metro = A.metro || new Metronome((n) => { const c = $("#cprCount"), num = $("#cprNum"), b = $("#cprBeat"); if (num) num.textContent = n % 30 || 30; if (c) c.textContent = n % 30 === 0 ? "30! 2 breaths if trained, then continue" : "Push hard and fast"; if (b) { b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); } });
    A.metro.running ? A.metro.stop() : A.metro.start(); render();
  });
  $$("[data-safe]").forEach((el) => (el.onclick = async () => {
    const name = ($("#safeName").value || "Anonymous").trim().slice(0, 24); store.set("safeName", name); buzz(20);
    const p = (await myPos()) || SITES.FIELD, id = rid(); A.lastSafe = id;
    send(`O|${id}|${el.dataset.safe}|${name}|${p[0].toFixed(4)},${p[1].toFixed(4)}`, "checkin");
  }));
  $$("[data-near]").forEach((el) => (el.onclick = () => { A.nearFilter = el.dataset.near; buzz(6); lastKey = lastKey; render(); }));
  $$("[data-place]").forEach((el) => (el.onclick = () => {
    const p = PLACES.find((x) => x.id === el.dataset.place), here = A.here || SITES.FIELD;
    openNav({ legs: [{ title: "To " + p.name, from: here, to: p.ll, to_label: p.name, kind: p.kind === "hospital" ? "hospital" : "pin", roads: [] }], eta: (distM(here, p.ll) / 1000).toFixed(1) + " km", dest: p.name });
  }));

  // navigation
  $$("[data-nav]").forEach((el) => (el.onclick = async () => {
    const d = A.inbox.find((m) => m.t === "D" && m.f[0] === el.dataset.nav); if (!d) return;
    const rr = A.inbox.find((m) => m.t === "RR" && m.f[0] === d.f[0] && m.at > d.at);
    const [id, , cmp, loc, h, eta, route] = d.f, hosp = rr ? rr.f[1] : h, roads = (rr ? rr.f[3] : route).split(">");
    const pick = loc.split(",").map(Number), here = (await myPos()) || EMS_LL, picked = A.jobState?.[id] === "PK";
    const legs = picked ? [] : [{ title: "To the patient", from: here, to: pick, to_label: "Patient · " + (CMP[cmp]?.[1] || cmp), roads: [] }];
    legs.push({ title: "To " + (HOSPITALS[hosp] || hosp), from: picked ? here : pick, to: HOSP_LL[hosp] || pick, to_label: HOSPITALS[hosp] || hosp, kind: "hospital", roads: roads.map(expandRoad) });
    openNav({ legs, eta: rr ? rr.f[2] + " min" : eta.replace("+", " + ") + " min", dest: HOSPITALS[hosp] || hosp });
  }));
  $$("[data-navw]").forEach((el) => (el.onclick = async () => {
    const [h, route] = el.dataset.navw.split("|"), here = (await myPos()) || SITES.FIELD;
    openNav({ legs: [{ title: "To " + HOSPITALS[h], from: here, to: HOSP_LL[h], to_label: HOSPITALS[h], kind: "hospital", roads: route.split(">").map(expandRoad) }], eta: "", dest: HOSPITALS[h] });
  }));

  // hospital
  const H = A.hospital, saveH = () => { store.set("hosp_" + A.ref, H); A.hDirty = true; };
  $$("[data-hs]").forEach((el) => (el.onclick = () => { H[el.dataset.hs] = Math.max(0, H[el.dataset.hs] + Number(el.dataset.d)); saveH(); buzz(6); render(); }));
  $$("[data-hc]").forEach((el) => (el.onclick = () => { const c = el.dataset.hc; H.caps = H.caps.includes(c) ? H.caps.replace(c, "") : H.caps + c; saveH(); buzz(6); render(); }));
  on("hOpen", () => { H.open = !H.open; saveH(); buzz(10); render(); });
  on("hSend", () => { A.hDirty = false; const e = send(`C|${A.ref}|${H.free}|${H.icu}|${H.caps}|${H.open ? 1 : 0}`, "capacity"); A.lastC = A.ref; e.then(() => toast("check", "Capacity sent", `${H.free} beds · ${H.icu} ICU`, "green")); });
  on("sSend", () => { send(`S|${rid()}|${A.ref}|${$("#sItem").value}|${Math.max(1, parseInt($("#sQty").value) || 1)}`, "supply"); toast("box", "Supply request sent", "Splitting across nearest pharmacies", "sky"); });

  // pharmacy
  const P = A.pharmacy, saveP = () => { store.set("ph_" + A.ref, P); A.pDirty = true; };
  $$("[data-ps]").forEach((el) => (el.onclick = () => { P.stock[el.dataset.ps] = Math.max(0, P.stock[el.dataset.ps] + Number(el.dataset.d)); saveP(); buzz(6); render(); }));
  on("pOpen", () => { P.open = !P.open; saveP(); buzz(10); render(); });
  on("pSend", () => { A.pDirty = false; A.lastP = A.ref; send(`P|${A.ref}|${P.open ? 1 : 0}|${Object.entries(P.stock).map(([k, v]) => k + ":" + v).join(",")}`, "stock").then(() => toast("check", "Stock sent", "Command centre updated", "green")); });
  $$("[data-pa]").forEach((el) => (el.onclick = () => {
    const m = A.inbox.find((x) => x.t === "MR" && x.f[0] === el.dataset.pa); m.state = el.dataset.ok; buzz(15);
    if (el.dataset.ok === "OK" && P.stock[m.f[1]] > 0) { P.stock[m.f[1]]--; store.set("ph_" + A.ref, P); }
    send(`PA|${el.dataset.pa}|${el.dataset.ok}|30`, "pharmacy");
  }));
}

// short route names from LoRa ("Ellesmere", "H401") back to full road names
function expandRoad(s) {
  s = s.replace("…", "").trim();
  if (/^H\d+/.test(s)) return "Hwy " + s.slice(1);
  return ROADS.find((r) => r.startsWith(s)) || (A.geo?.names || []).find((r) => r.startsWith(s)) || s;
}

// responders share GPS over the mesh every 30 s while they have an active job (feeds live traffic)
setInterval(async () => {
  if (A.role !== "responder" || link.status !== "connected" || link.kind === "sim") return;
  const active = A.inbox.some((m) => m.t === "D" && A.jobState?.[m.f[0]] !== "DL");
  if (!active) return;
  const p = await myPos(); if (p) link.send(`L|${p[0].toFixed(5)},${p[1].toFixed(5)}`).catch(() => {});
}, 30000);

// ------------------------------------------------------------------ QR scanning (BarcodeDetector when available, jsQR fallback)
let scanStream = null, scanRaf = 0;
async function startScan() {
  const msg = (t) => { const e = $("#scanMsg"); if (e) e.textContent = t; };
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = $("#vid"); v.srcObject = scanStream; await v.play();
    const det = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    const loop = async () => {
      if (!scanStream) return;
      let txt = null;
      try {
        if (det) { const r = await det.detect(v); txt = r[0]?.rawValue; }
        else if (v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0); const img = cx.getImageData(0, 0, cv.width, cv.height); txt = jsQR(img.data, img.width, img.height)?.data; }
      } catch (e) {}
      const m = txt && txt.match(/MEDMESH:([A-Z0-9]{6})/);
      if (m) { stopScan(); if (A.q) A.q.mid = m[1]; buzz(80); toast("check", "Medical ID scanned", m[1], "green"); A.screen = A.scanReturn || "home"; render(); return; }
      scanRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) { msg("Camera not available (" + e.message + "). Type the code instead."); }
}
function stopScan() { cancelAnimationFrame(scanRaf); if (scanStream) scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }

// tick ETA countdowns once a second without rebuilding the page
setInterval(() => {
  const el = $("#homeEta"); const c = A.cases.slice(-1)[0];
  if (el && c) { const s = caseState(c.id); if (s.eta) el.textContent = s.eta; }
  if (A.screen === "track" && A.trackMap) { const b = $("#trackBadge"), c2 = A.cases.find((x) => x.id === A.trackId); if (b && c2) { const s = caseState(c2.id); if (s.eta) b.innerHTML = `<b>${s.eta}</b><small>${s.etaLabel}</small>`; } }
}, 1000);

// ------------------------------------------------------------------ boot
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
render();
