"""MedMesh base station / command centre.

Run with hardware:   python server.py --port /dev/cu.usbserial-0001   (or omit --port to auto-detect)
Run without:         python server.py --sim
Then open            http://localhost:8000          (command-centre dashboard)
                     http://localhost:8000/app/     (mobile app; use Simulator mode or USB)
"""
import argparse, asyncio, copy, json, math, os, random, re, sqlite3, string, threading, time
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

import ai
from data import HOSPITALS, PHARMACIES, PROFILES, EMS_POST, MED_NAMES, NODE_LAYOUT, BASE_PRICES, EMERGENCY_PRICES
from engine import sos_ai
from logic import (RoadNet, parse, parse_latlon, parse_extras, fit, start_triage,
                   red_flags, prepare_list, short_route, haversine_m, COMPLAINTS, TRIAGE)
from mesh import SerialBridge, SimBridge
from engine import Engine, DuplicateDetector, AuditLog, plan_supply

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ------------------------------------------------------------------ state
S = {
    "mode": "sim", "hospitals": copy.deepcopy(HOSPITALS), "pharmacies": copy.deepcopy(PHARMACIES),
    "cases": {}, "requests": {}, "supplies": {}, "blocked": [], "floods": [], "nodes": {}, "roles": {},
    "log": [], "summary": None, "ai": False, "slow": {}, "traffic": [], "ambulances": {}, "sim_traffic": {}, "alerts": [], "checkins": [], "hazard": None, "incidents": {}, "notifications": [], "road_reports": [], "ems": EMS_POST, "layout": NODE_LAYOUT,
}
LOCK = threading.RLock()
NET = RoadNet()
ENG = Engine(NET, S["hospitals"])          # dispatch engine: routing, queueing, bed nowcast, optimisation
DEDUP = DuplicateDetector()
AUDIT = AuditLog(os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit.jsonl"))
BRIDGE = None
LOOP = None
CLIENTS = set()
SEEN = {}

db = sqlite3.connect(os.path.join(HERE, "medmesh.db"), check_same_thread=False)
db.executescript("""
CREATE TABLE IF NOT EXISTS messages(ts REAL, dir TEXT, node TEXT, text TEXT, hops INTEGER);
CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, json TEXT, updated REAL);
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, json TEXT, updated REAL);
""")
# MedMesh ID profiles synced before the disaster are stored on the command-centre laptop and reloaded at start,
# so they are available offline for the whole emergency.
for _pid, _js in db.execute("SELECT id, json FROM profiles"):
    PROFILES[_pid] = json.loads(_js)


def now_s():
    return datetime.now().strftime("%H:%M:%S")


def hosp(hid):
    return next((h for h in S["hospitals"] if h["id"] == hid), None)


def pharm(pid):
    return next((p for p in S["pharmacies"] if p["id"] == pid), None)


def log(direction, node, text, hops=None, kind="msg", path=None):
    S["seq"] = S.get("seq", 0) + 1
    entry = {"seq": S["seq"], "t": now_s(), "dir": direction, "node": node, "text": text, "hops": hops, "kind": kind,
             "bytes": len(text.encode()), "path": path}
    S["log"].append(entry)
    S["log"] = S["log"][-200:]
    with LOCK:
        db.execute("INSERT INTO messages VALUES(?,?,?,?,?)", (time.time(), direction, node, text, hops))
        db.commit()


def save_case(c):
    with LOCK:
        db.execute("INSERT OR REPLACE INTO cases VALUES(?,?,?)", (c["id"], json.dumps(c, default=str), time.time()))
        db.commit()


def push():
    """Notify dashboards that state changed."""
    if LOOP:
        LOOP.call_soon_threadsafe(lambda: asyncio.ensure_future(_broadcast()))


async def _broadcast():
    snap = json.dumps({"type": "state", "state": snapshot()}, default=str)
    for ws in list(CLIENTS):
        try:
            await ws.send_text(snap)
        except Exception:
            CLIENTS.discard(ws)


def snapshot():
    with LOCK:
        s = {k: v for k, v in S.items()}
        s["outbox"] = BRIDGE.outbox[-60:] if isinstance(BRIDGE, SimBridge) else []
        return s


def send(text, dest=None, note=None):
    text = fit(text)
    try:
        BRIDGE.send(text, dest)
        log("out", S["nodes"].get(dest, {}).get("name", dest or "ALL"), text, kind=note or "msg")
    except Exception as e:
        log("err", dest or "ALL", f"send failed: {e}", kind="error")


def nodes_with_role(role, ref=None):
    return [nid for nid, r in S["roles"].items() if r["role"] == role and (ref is None or r.get("ref") == ref)]


def new_id(prefix=""):
    return prefix + "".join(random.choices(string.ascii_lowercase + string.digits, k=4))


# ------------------------------------------------------------------ message handling
def on_text(text, frm, frm_name, hops, path):
    with LOCK:
        try:
            handle(text.strip(), frm, frm_name, hops, path)
        except Exception as e:  # never let a bad message kill the bridge
            log("err", frm_name, f"{text} -> {e!r}", kind="error")
    push()


def handle(text, frm, name, hops, path):
    log("in", name, text, hops, path=path)
    t, f = parse(text)
    if not t:
        return  # free-text chat; shown in the log only
    key = (t, f[0] if f else "", frm)
    if t in "RMQS" and key in SEEN and time.time() - SEEN[key] < 600:
        send(f"A|{f[0]}|OK", frm, "ack")  # duplicate (app retry): just re-ack
        return
    SEEN[key] = time.time()
    fn = HANDLERS.get(t)
    if fn:
        fn(f, frm, name, hops, path)


def h_join(f, frm, name, hops, path):
    # J|role|ref|label     role: P patient, R responder, H hospital, X pharmacy
    role = {"P": "patient", "R": "responder", "H": "hospital", "X": "pharmacy"}.get(f[0] if f else "P", "patient")
    S["roles"][frm] = {"role": role, "ref": f[1] if len(f) > 1 else "", "label": f[2] if len(f) > 2 else name}
    send(f"A|J|OK", frm, "ack")


def h_report(f, frm, name, hops, path):
    # R|id|triage|complaint|age|count|flags|lat,lon|medmeshID|extras
    cid = f[0]
    flags = (f[5] if len(f) > 5 else "") or "1N10"
    walk, br, resp, bleed = flags[0] == "1", {"N": "normal", "F": "fast", "X": "none"}.get(flags[1], "normal"), flags[2] == "1", flags[3] == "1"
    tri = start_triage(walk, br, resp, bleed)
    try:
        n_scene = int(f[4]) if len(f) > 4 and f[4].isdigit() else 1
    except ValueError:
        n_scene = 1
    if tri == 4 and n_scene <= 3:
        tri = 1   # START "expectant" is for mass-casualty scenes; a lone person not breathing needs help first (CPR)
    loc = parse_latlon(f[6]) if len(f) > 6 else None
    loc = loc or S["layout"]["FIELD"]
    mid = (f[7] if len(f) > 7 else "").upper().strip()
    profile = PROFILES.get(mid) if mid else None
    c = {"id": cid, "time": now_s(), "ts": time.time(), "from": name, "from_id": frm, "hops": hops, "path": path,
         "triage": tri, "app_triage": int(f[1]) if f[1].isdigit() else None, "complaint": f[2], "age": f[3],
         "count": f[4], "walk": walk, "breathing": br, "responds": resp, "bleeding": bleed, "loc": loc,
         "mid": mid, "profile": profile, "mid_unknown": bool(mid and not profile),
         "extras": parse_extras(f[8] if len(f) > 8 else ""), "status": "new", "events": [f"{now_s()} report received ({hops} hops)"]}
    S["cases"][cid] = c
    send(f"A|{cid}|OK", frm, "ack")
    scene = c["extras"].get("INC")
    if scene:
        c["incident"] = scene
        z = S["incidents"].setdefault(scene, {"id": scene, "time": now_s(), "count": n_scene, "loc": loc, "cause": "", "cases": [], "from": name})
        if cid not in z["cases"]:
            z["cases"].append(cid)
        c["events"].append(f"{now_s()} part of scene {scene} ({len(z['cases'])} of {z['count']} people reported)")
    if c["extras"].get("NT"):
        c["events"].append(f"{now_s()} note: {c['extras']['NT']}")
    if c["extras"].get("HZ"):
        c["events"].append(f"{now_s()} DANGER at scene: {c['extras']['HZ']}")
    inc, dup, matched = DEDUP.add(cid, loc, c["complaint"], mid, c["ts"])
    parent = S["cases"].get(inc)
    if dup and parent and parent["status"] in ("dispatched", "en_route", "picked_up", "no_route"):
        c.update({"status": "merged", "duplicate_of": inc})
        c["events"].append(f"{now_s()} same incident as {inc} (within 150 m / 15 min, same complaint): merged")
        parent.setdefault("reports", []).append(cid)
        parent["events"].append(f"{now_s()} another report of this incident from {name} ({cid})")
        AUDIT.append("merge", {"case": cid, "into": inc, "matched": matched})
        send(f"H|{cid}|AMB|{parent.get('pickup_eta') or '?'}|Already reported: an ambulance is on the way to this location.", frm, "help")
        save_case(c)
        return
    assign(c)


def units_available():
    """Ambulance start points: the EMS post plus any responder/ambulance not currently on a case."""
    u = {"EMS": (S["ems"]["lat"], S["ems"]["lon"])}
    busy = {c["id"] for c in S["cases"].values() if c["status"] in ("dispatched", "en_route", "picked_up")}
    for k, a in S["ambulances"].items():
        if a.get("lat") is not None and a.get("case") not in busy:
            u[k] = (a["lat"], a["lon"])
    return u


def decide(c, start, onboard=False):
    """Run the dispatch engine and adapt its decision to the case/dashboard format.
    Returns (best, rows, relaxed, record). best carries the turn-by-turn route to the chosen facility."""
    rec = ENG.evaluate({**c, "patient": c.get("profile")}, start,
                       set(S["blocked"]), S["floods"], units_available(), onboard=onboard)
    rows = []
    for r in rec["candidates"]:
        rows.append({"id": r["id"], "name": r["name"], "ok": r["eligible"], "cap_ok": r["cap_ok"],
                     "eta": None if r.get("drive_min") is None else max(1, round(r["drive_min"])),
                     "score": r.get("cost") and round(r["cost"], 3), "why": r["why_out"],
                     "breakdown": (f"{r['time_to_treatment']:.0f} min to treatment = drive {r['drive_min']:.0f}"
                                   f" + wait {r['wait_min']:.0f}" + (f" + bed risk {r['p_no_bed']:.0%}" if r["p_no_bed"] > 0.01 else ""))
                     if "time_to_treatment" in r else ""})
    best = None
    if rec["chosen"]:
        h = hosp(rec["chosen"])
        rt = NET.route(start, (h["lat"], h["lon"]), set(S["blocked"]), S["floods"], h["name"])
        if rt:
            best = {"id": h["id"], "name": h["name"], "eta": rt["eta"], "route": rt}
    return best, rows, rec["relaxed"], rec


def audit_view(rec):
    """Compact decision record for the audit log."""
    return {"case": rec["case"], "chosen": rec["chosen"], "runner_up": rec["runner_up"], "relaxed": rec["relaxed"],
            "triage": rec["profile"]["triage"], "complaint": rec["profile"]["complaint"], "unit": rec["unit"],
            "explain": rec["explain"], "compute_ms": rec["compute_ms"],
            "candidates": [{k: r.get(k) for k in ("id", "eligible", "why_out", "drive_min", "wait_min", "beds", "beds_source",
                                                   "p_no_bed", "time_to_treatment", "outcome_loss", "cost")} for r in rec["candidates"]]}


def assign(c, reroute=False):
    amb = S["ambulances"].get(c["id"])
    onboard = c["status"] == "picked_up" and amb
    start = (amb["lat"], amb["lon"]) if onboard else c["loc"]
    best, rows, relaxed, rec = decide(c, start, onboard)
    c["options"] = [{k: r.get(k) for k in ("id", "name", "ok", "cap_ok", "eta", "score", "why", "breakdown")} for r in rows]
    c["relaxed"] = relaxed
    c["decision"] = rec
    old = c.get("hospital")
    if not best:
        c["status"] = "no_route"
        c["events"].append(f"{now_s()} NO reachable hospital - escalate")
        send(f"H|{c['id']}|WAIT|0|Help requested. No route yet - stay safe, we will update you", c["from_id"], "help")
        save_case(c)
        return
    h = hosp(best["id"])
    if old != h["id"]:
        if old and hosp(old):
            hosp(old)["free"] += 1
        h["free"] -= 1
    ENG.release(c["id"])
    ENG.commit(rec)
    AUDIT.append("reroute" if reroute else "dispatch", audit_view(rec))
    amb_from = (amb["lat"], amb["lon"]) if amb and c["status"] == "dispatched" else (S["ems"]["lat"], S["ems"]["lon"])
    to_patient = None if onboard else NET.route(amb_from, c["loc"], set(S["blocked"]), S["floods"], "patient")
    best["route"]["steps"][-1]["text"] = f"Arrive at {h['name']}"
    c.update({"hospital": h["id"], "hospital_name": h["name"], "eta": best["eta"], "route": best["route"],
              "pickup_route": to_patient, "pickup_eta": (to_patient["eta"] if to_patient else 0) if not onboard else 0})
    if amb:
        amb.update({"d": 0.0, "phase": "hospital" if onboard else "pickup"})
    c["status"] = "dispatched" if not reroute else c["status"]
    c.setdefault("t_dispatch", time.time())
    if reroute:
        c["reroutes"] = c.get("reroutes", 0) + 1
    c["flags"] = c.get("flags") or red_flags(c, c["profile"])
    if relaxed and not any(f["flag"].startswith("No hospital") for f in c["flags"]):
        need = {"CP": "cardiac", "BU": "burns", "PR": "obstetrics", "BL": "trauma", "FX": "trauma"}.get(c["complaint"], "specialist")
        c["flags"].insert(0, {"flag": f"No hospital with {need} care reachable: stabilise, plan transfer", "why": "capability filter relaxed", "ack": False})
    c["prepare"] = prepare_list(c)
    tag = "REROUTE" if reroute else "dispatched"
    c["events"].append(f"{now_s()} {tag}: {h['name']} via {short_route(best['route']['roads'], 80)} ({best['eta']} min)"
                       + (" [capability relaxed]" if relaxed else ""))
    rs = short_route(best["route"]["roads"])
    lat, lon = c["loc"]
    pe = c["pickup_eta"] or "?"
    rnodes = nodes_with_role("responder")
    if rnodes and not c.get("responder"):
        c["responder"] = rnodes[0]
    for r in rnodes or [None]:
        if reroute:
            send(f"RR|{c['id']}|{h['id']}|{best['eta']}|{rs}", r, "reroute")
        else:
            send(f"D|{c['id']}|{c['triage']}|{c['complaint']}|{lat:.4f},{lon:.4f}|{h['id']}|{pe}+{best['eta']}|{rs}", r, "dispatch")
    if not reroute:
        send(f"H|{c['id']}|AMB|{pe}|Ambulance assigned to {h['name']}. Stay where you are.", c["from_id"], "help")
        ambulance_update(c, amb_from[0], amb_from[1], force=True)
        notify_contact(c, "dispatched")
    else:
        send(f"H|{c['id']}|RR|{best['eta']}|Route changed: now going to {h['name']}", c["from_id"], "help")
        if old != h["id"]:
            notify_contact(c, "rerouted")
            if old:
                incoming_update(c, "AWAY", 0, old)
    for hn in nodes_with_role("hospital", h["id"]):
        al = (c["profile"] or {}).get("allergies") or ([c["extras"]["AL"]] if c["extras"].get("AL") else [])
        bg = (c["profile"] or {}).get("blood") or c["extras"].get("BG", "?")
        send(f"I|{c['id']}|{c['triage']}|{c['complaint']}|{c['age']}|{pe}+{best['eta']}|BG:{bg}" + (f";AL:{','.join(al)[:20]}" if al else ""), hn, "incoming")
    save_case(c)
    threading.Thread(target=_sbar_async, args=(c["id"],), daemon=True).start()


def _sbar_async(cid):
    c = S["cases"].get(cid)
    if not c:
        return
    out = ai.sbar(c, c["profile"])
    with LOCK:
        c["sbar"] = out
        save_case(c)
    push()


def h_status(f, frm, name, hops, path):
    # U|caseid|PK|DL   picked up / delivered
    c = S["cases"].get(f[0])
    if not c:
        return
    st = {"PK": "picked_up", "DL": "delivered", "EN": "en_route"}.get(f[1], f[1])
    c["status"] = st
    c["events"].append(f"{now_s()} responder: {st.replace('_', ' ')}")
    if st == "picked_up":
        send(f"H|{c['id']}|PK|{c['eta']}|Paramedics have the patient, going to {c['hospital_name']}", c["from_id"], "help")
    save_case(c)


def reroute_all(reason):
    for c in S["cases"].values():
        if c["status"] in ("dispatched", "en_route", "picked_up", "no_route"):
            uses = c.get("route") and any(r in S["blocked"] for r in c["route"]["roads"])
            flooded = c.get("route") and any(haversine_m(p, (fz["lat"], fz["lon"])) <= fz["r"]
                                             for fz in S["floods"] for p in c["route"]["coords"])
            if uses or flooded or c["status"] == "no_route":
                c["events"].append(f"{now_s()} {reason}")
                assign(c, reroute=True)


def reroute_if_better(reason, min_gain=1):
    """Traffic changed: re-plan active trips; switch only if the plan actually changes and is faster."""
    for c in list(S["cases"].values()):
        if c["status"] not in ("dispatched", "picked_up") or not c.get("route"):
            continue
        amb = S["ambulances"].get(c["id"])
        start = (amb["lat"], amb["lon"]) if (c["status"] == "picked_up" and amb) else c["loc"]
        best, _, _, _ = decide(c, start, onboard=c["status"] == "picked_up")
        if not best:
            continue
        cur = NET.route(start, (hosp(c["hospital"])["lat"], hosp(c["hospital"])["lon"]), set(S["blocked"]), S["floods"])
        changed = best["id"] != c["hospital"] or best["route"]["roads"] != c["route"]["roads"]
        if changed and (cur is None or best["route"]["eta"] + min_gain <= cur["eta"]):
            c["events"].append(f"{now_s()} {reason}: {cur['eta'] if cur else '?'} min on old route")
            assign(c, reroute=True)


def set_slow(road, factor, reason, by):
    if factor <= 1:
        NET.slow.pop(road, None); S["slow"].pop(road, None)
    else:
        NET.slow[road] = factor
        S["slow"][road] = {"factor": factor, "reason": reason, "by": by, "t": now_s()}
    reroute_if_better(f"{road} {'slow (' + reason + ')' if factor > 1 else 'cleared'}")


def h_slow(f, frm, name, hops, path):
    # K|road|reason      congestion / passable debris: road counts as 3x slower (not removed)
    road = f[0].strip()
    match = next((r for r in NET.road_names if r.lower().startswith(road.lower()[:6])), road)
    send("A|K|OK", frm, "ack")
    set_slow(match, 3.0, f[1] if len(f) > 1 else "slow traffic", name)


def learn(node, lat, lon, ts, case_id=None):
    """Live traffic: turn successive ambulance positions into a speed on the road it's driving,
    compare with the free-flow speed, and update that road segment's congestion factor."""
    a = S["ambulances"].setdefault(case_id or node, {"node": node, "case": case_id, "d": 0.0, "phase": "pickup"})
    prev = a.get("fix")
    a.update({"lat": lat, "lon": lon, "ts": ts})
    a["fix"] = (lat, lon, ts)
    if not prev:
        return
    dt, dist = ts - prev[2], haversine_m((prev[0], prev[1]), (lat, lon))
    if dt < 3 or dist < 8:
        return
    kmh = dist / dt * 3.6
    a["kmh"] = round(kmh)
    e = NET.nearest_edge(((prev[0] + lat) / 2, (prev[1] + lon) / 2))
    if not e or NET.nearest_edge((prev[0], prev[1])) is not e or NET.nearest_edge((lat, lon)) is not e:
        return  # crossed an intersection between fixes: speed isn't attributable to one road
    a["road"] = e["name"]
    obs = max(1.0, min(5.0, e["speed"] / max(kmh, 3)))
    old = NET.live.get(e["i"], 1.0)
    new = round(0.4 * old + 0.6 * obs, 2)
    if new < 1.15:
        NET.live.pop(e["i"], None)
    else:
        NET.live[e["i"]] = new
    # share what we learned with the rest of that road block (same name, touching segments)
    for nb in NET.edges:
        if nb["name"] == e["name"] and nb["i"] != e["i"] and ({nb["u"], nb["v"]} & {e["u"], e["v"]}):
            if new >= 1.15: NET.live[nb["i"]] = max(NET.live.get(nb["i"], 1.0), round(1 + (new - 1) * 0.6, 2))
    S["traffic"] = [{"i": i, "f": f} for i, f in NET.live.items()]
    if abs(new - old) >= 0.5:
        S["traffic_events"] = (S.get("traffic_events") or [])[-20:] + [f"{now_s()} {e['name']}: ambulance doing {round(kmh)} km/h (limit {round(e['speed'])})"]
        reroute_if_better(f"live traffic on {e['name']}")


def on_position(frm, name, lat, lon, ts=None):
    with LOCK:
        cid = next((c["id"] for c in S["cases"].values() if c.get("responder") == frm and c["status"] in ("dispatched", "picked_up")), None)
        learn(frm, lat, lon, ts or time.time(), cid)
    push()


AL_EVERY_S = float(os.environ.get("MEDMESH_AL_EVERY", "15"))   # airtime: on real LoRa use 45-60 s


def route_len_m(rt):
    if not rt:
        return 0.0
    if "len_m" not in rt:
        cs = rt["coords"]
        rt["len_m"] = sum(haversine_m(a, b) for a, b in zip(cs, cs[1:]))
    return rt["len_m"]


def ambulance_update(c, lat, lon, force=False):
    """AL|caseid|lat,lon|etaMin|hospID|phase   tells the patient's phone where the ambulance is (P = coming to you,
    H = taking you to hospital). Throttled to save airtime; the phone counts the ETA down between updates."""
    a = S["ambulances"].get(c["id"]) or {}
    now = time.time()
    if not force and now - a.get("al_t", 0) < AL_EVERY_S:
        return
    a["al_t"] = now
    phase = "H" if c["status"] == "picked_up" else "P"
    rt = c.get("route") if phase == "H" else c.get("pickup_route")
    total = route_len_m(rt)
    full = (c.get("eta") if phase == "H" else c.get("pickup_eta")) or 0
    left = max(0, round(full * (1 - min(1.0, a.get("d", 0.0) / total)))) if total else full
    send(f"AL|{c['id']}|{lat:.5f},{lon:.5f}|{left}|{c.get('hospital', '')}|{phase}", c["from_id"], "where")


# ------------------------------------------------------------------ emergency contact
_PHONE = re.compile(r"\+?\d[\d\s().-]{6,}\d")


def notify_contact(c, event):
    """Text the person's emergency contact (from their MedMesh ID) at each step. Uses an SMS gateway when the command
    centre has any internet (Twilio env vars); otherwise the message waits in the queue and is shown on the dashboard."""
    prof = c.get("profile") or {}
    contact = str(prof.get("contact") or "").strip()
    if not contact or contact.lower() == "none":
        return
    m = _PHONE.search(contact)
    phone = re.sub(r"[^\d+]", "", m.group(0)) if m else ""
    who = contact.split(",")[0].strip()[:40] or "Emergency contact"
    name = prof.get("name") or "Someone in your family"
    h = c.get("hospital_name") or "hospital"
    body = {
        "dispatched": f"MedMesh: {name} needs medical help. An ambulance is on the way and will take them to {h}. "
                      f"Pickup in about {c.get('pickup_eta') or '?'} min. Ref {c['id']}.",
        "rerouted": f"MedMesh: {name} is now being taken to {h} instead. Ref {c['id']}.",
        "picked_up": f"MedMesh: paramedics are with {name} and are taking them to {h}. Ref {c['id']}.",
        "arrived": f"MedMesh: {name} has arrived at {h}. Ref {c['id']}.",
    }[event]
    n = {"id": new_id("t"), "case": c["id"], "to": who, "phone": phone, "event": event, "text": body, "time": now_s(), "status": "queued"}
    S.setdefault("notifications", []).append(n)
    S["notifications"] = S["notifications"][-100:]
    c["events"].append(f"{now_s()} text to {who}: {event}")
    log("out", f"SMS {who}", body, kind="sms")
    if event == "dispatched":
        send(f"CN|{c['id']}|QUEUED|{who}", c["from_id"], "contact")
    threading.Thread(target=_deliver_sms, args=(n, c["from_id"]), daemon=True).start()


def _deliver_sms(n, phone_node):
    sid, token, frm = (os.environ.get(k) for k in ("TWILIO_SID", "TWILIO_TOKEN", "TWILIO_FROM"))
    if not (sid and token and frm and n["phone"]):
        n["status"] = "queued" if n["phone"] else "no phone number"
        return
    import base64, urllib.parse, urllib.request
    req = urllib.request.Request(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                                 data=urllib.parse.urlencode({"To": n["phone"], "From": frm, "Body": n["text"]}).encode(),
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode()})
    try:
        urllib.request.urlopen(req, timeout=15)
        n["status"] = "sent"
        with LOCK:
            if n["event"] == "dispatched":
                send(f"CN|{n['case']}|SENT|{n['to']}", phone_node, "contact")
    except Exception as e:  # no internet yet: stays queued, retried by the dashboard button / next event
        n["status"] = f"queued ({type(e).__name__})"


def h_loc(f, frm, name, hops, path):
    # L|lat,lon        responder phone GPS, every ~30 s
    ll = parse_latlon(f[0])
    if ll:
        cid = next((c["id"] for c in S["cases"].values() if c.get("responder") == frm and c["status"] in ("dispatched", "picked_up")), None)
        learn(frm, ll[0], ll[1], time.time(), cid)
        if cid:
            ambulance_update(S["cases"][cid], ll[0], ll[1])


def h_checkin(f, frm, name, hops, path):
    # O|id|SAFE or NEED|name|lat,lon      community check-in ("I'm safe" / "need help, not urgent")
    cid = f[0]
    # O|id|SAFE/NEED|name|lat,lon|medmeshID   (the ID lets the registry know this person is fine)
    S["checkins"].append({"id": cid, "t": now_s(), "ts": time.time(), "status": f[1] if len(f) > 1 else "SAFE", "name": f[2] if len(f) > 2 else name,
                          "loc": parse_latlon(f[3]) if len(f) > 3 else None, "mid": (f[4] if len(f) > 4 else "").upper(), "via": name, "hops": hops})
    S["checkins"] = S["checkins"][-100:]
    send(f"A|{cid}|OK", frm, "ack")


def broadcast_alert(text, level="INFO"):
    aid = new_id("n")
    S["alerts"].append({"id": aid, "t": now_s(), "level": level, "text": text})
    S["alerts"] = S["alerts"][-30:]
    send(fit(f"N|{aid}|{level}|{text}"), None, "alert")


def h_block(f, frm, name, hops, path):
    # B|road name|reason
    road = f[0].strip()
    match = next((r for r in NET.road_names if r.lower().startswith(road.lower()[:6])), road)
    if match not in S["blocked"]:
        S["blocked"].append(match)
    send(f"A|B|OK", frm, "ack")
    confirm_pending_near(road=match, by=f"responder {name}")
    reroute_all(f"{match} blocked ({f[1] if len(f) > 1 else 'reported'}) by {name}")


def h_flood(f, frm, name, hops, path):
    ll = parse_latlon(f[0])
    if ll:
        S["floods"].append({"lat": ll[0], "lon": ll[1], "r": float(f[1]) if len(f) > 1 else 400})
        confirm_pending_near(ll=ll, by=f"responder/sensor {name}")
        reroute_all(f"flood zone reported by {name}")


# ------------------------------------------------------------------ citizen road reports
ROAD_KINDS = {"BLOCK": "blocked", "FLOOD": "flooded", "DEBRIS": "debris / slow", "FIRE": "fire"}
CONFIRM_WINDOW_S = 30 * 60


def canonical_road(road):
    return next((r for r in NET.road_names if road and r.lower().startswith(road.lower()[:6])), road)


def h_road(f, frm, name, hops, path):
    """RD|id|BLOCK/FLOOD/DEBRIS/FIRE|lat,lon|road     a citizen reports a road problem.
    One report only slows the road (3x travel time) so ambulances avoid it without trusting a single person.
    A second person, a responder or a sensor confirms it: then the road is closed / the flood zone applied."""
    rid = f[0]
    kind = (f[1] if len(f) > 1 else "BLOCK").upper()
    kind = kind if kind in ROAD_KINDS else "BLOCK"
    ll = parse_latlon(f[2]) if len(f) > 2 else None
    road = f[3].strip() if len(f) > 3 else ""
    if ll and not road:
        e = NET.nearest_edge(ll, 400)
        road = e["name"] if e else ""
    road = canonical_road(road)
    send(f"A|{rid}|OK", frm, "ack")
    now = time.time()
    reps = S.setdefault("road_reports", [])
    rep = next((r for r in reps if r["kind"] == kind and now - r["t"] < CONFIRM_WINDOW_S and not r.get("cleared")
                and ((road and r["road"] == road) or (ll and r.get("ll") and haversine_m(ll, r["ll"]) < 250))), None)
    if not rep:
        rep = {"id": rid, "kind": kind, "road": road, "ll": ll, "t": now, "time": now_s(), "reporters": [], "ids": [], "confirmed": False}
        reps.append(rep)
    if frm not in rep["reporters"]:
        rep["reporters"].append(frm)
    rep["ids"].append(rid)
    rep.setdefault("by_id", {})[rid] = frm
    log("road", name, f"{ROAD_KINDS[kind]}: {road or 'unknown road'} ({len(rep['reporters'])} report{'s' if len(rep['reporters']) > 1 else ''})", kind="alert")
    if len(rep["reporters"]) >= 2 or kind == "DEBRIS":
        confirm_road(rep, f"{len(rep['reporters'])} people")
    elif road:
        set_slow(road, 3.0, f"unconfirmed {ROAD_KINDS[kind]} report", name)
    for i in (rep["ids"] if rep["confirmed"] else [rid]):     # on confirmation, tell every reporter
        send(f"RA|{i}|{'CONFIRMED' if rep['confirmed'] else 'PENDING'}|{len(rep['reporters'])}|{road}", rep["by_id"].get(i, frm), "road")


def confirm_road(rep, by):
    if rep["confirmed"]:
        return
    rep["confirmed"] = True
    rep["confirmed_by"] = by
    road, kind = rep["road"], rep["kind"]
    if kind == "DEBRIS":
        if road:
            set_slow(road, 3.0, "debris (citizen report)", by)
        return
    if kind == "FLOOD" and rep.get("ll"):
        S["floods"].append({"lat": rep["ll"][0], "lon": rep["ll"][1], "r": 200})
        if road:
            set_slow(road, 1.0, "", by)
        reroute_all(f"flood confirmed near {road or 'reported spot'} ({by})")
    elif road:
        if road not in S["blocked"]:
            S["blocked"].append(road)
        set_slow(road, 1.0, "", by)
        reroute_all(f"{road} {ROAD_KINDS[kind]}: confirmed by {by}")


def confirm_pending_near(road=None, ll=None, by="responder"):
    """Responder/sensor reports confirm matching citizen reports."""
    for r in S.get("road_reports", []):
        if r["confirmed"] or time.time() - r["t"] > CONFIRM_WINDOW_S:
            continue
        if (road and r["road"] == road) or (ll and r.get("ll") and haversine_m(ll, r["ll"]) < 400):
            confirm_road(r, by)


def h_hospital(f, frm, name, hops, path):
    # C|hospID|free|icu|caps|open
    h = hosp(f[0])
    if not h:
        return
    h["free"], h["icu"] = int(f[1]), int(f[2])
    if len(f) > 3: h["caps"] = f[3]
    if len(f) > 4: h["open"] = f[4] == "1"
    if len(f) > 5 and f[5].isdigit(): h["er_wait"] = int(f[5])
    if len(f) > 6: h["note"] = f[6][:40]          # free text from the hospital, e.g. "No MRI" / "Neurosurgeon on call"
    h["updated"] = f"{now_s()} via mesh"
    ENG.report(h["id"], free=h["free"], wait=h.get("er_wait") if len(f) > 5 else None)
    AUDIT.append("hospital_report", {"hospital": h["id"], "free": h["free"], "icu": h["icu"], "open": h["open"], "via": name})
    send(f"A|C|OK", frm, "ack")


def h_pharm(f, frm, name, hops, path):
    # P|pharmID|open|INSULIN:12,INHALER:3
    p = pharm(f[0])
    if not p:
        return
    p["open"] = f[1] == "1"
    for kv in (f[2] if len(f) > 2 else "").split(","):   # ITEM:qty or ITEM:qty@price
        if ":" in kv:
            k, v = kv.split(":", 1)
            qty, _, price = v.partition("@")
            p["stock"][k] = int(qty)
            if price:
                p.setdefault("prices", {})[k] = float(price)
    p["updated"] = f"{now_s()} via mesh"
    over = [(k, pr, price_check(k)["cap"]) for k, pr in (p.get("prices") or {}).items()
            if BASE_PRICES.get(k) and pr > BASE_PRICES[k] * (1 + PRICE_CAP_PCT / 100)]
    for k, pr, cap in over:
        log("price", p["name"], f"set {k} at ${pr:.2f}, above the ${cap:.2f} cap: requests go to fair-priced places first", kind="alert")
    AUDIT.append("stock_update", {"pharmacy": p["id"], "open": p["open"], "stock": dict(p["stock"]), "prices": dict(p.get("prices") or {}),
                                  "over_cap": [k for k, _, _ in over], "via": name})
    send(f"A|P|OK", frm, "ack")


def pick_pharmacy(item, qty, loc, exclude=()):
    opts = []
    for p in S["pharmacies"]:
        if p["open"] and p["id"] not in exclude and p["stock"].get(item, 0) >= qty:
            opts.append((haversine_m(loc, (p["lat"], p["lon"])), p))
    return min(opts, key=lambda x: x[0])[1] if opts else None


def h_scene(f, frm, name, hops, path):
    # Z|sceneid|count|lat,lon|cause     one message for a scene with several casualties, sent BEFORE the per-person R| reports
    zid = f[0]
    count = int(f[1]) if len(f) > 1 and f[1].isdigit() else 2
    loc = (parse_latlon(f[2]) if len(f) > 2 else None) or S["layout"]["FIELD"]
    z = S["incidents"].setdefault(zid, {"id": zid, "time": now_s(), "cases": [], "from": name})
    z.update({"count": max(count, z.get("count", 0)), "loc": loc, "cause": f[3] if len(f) > 3 else z.get("cause", ""),
              "hazards": [h for h in (f[4].split(",") if len(f) > 4 else []) if h], "vehicles": f[5] if len(f) > 5 else ""})
    danger = f" · DANGER: {', '.join(z['hazards'])}" if z["hazards"] else ""
    log("scene", name, f"{count} people need help · {z['cause'] or 'cause unknown'}{danger}", kind="alert")
    for hn in nodes_with_role("hospital"):
        send(f"ZA|{zid}|{count}|{z['cause']}|{','.join(z['hazards'])}", hn, "scene")
    send(f"A|{zid}|OK", frm, "ack")
    send(f"H|{zid}|WAIT|0|Scene received: {count} people. Tell us about the most hurt person first.", frm, "help")


def h_voice(f, frm, name, hops, path):
    # V|id|lat,lon|lang|text      the caller's own words (any language), when the phone could not fill the form itself
    vid = f[0]
    loc_s = f[1] if len(f) > 1 else ""
    text = "|".join(f[3:]) if len(f) > 3 else ""
    send(f"A|{vid}|OK", frm, "ack")
    out = sos_ai.interpret(text=text)
    res = out.get("result")
    if not res:
        return
    zid = vid if res["count"] > 1 else ""
    if zid:
        h_scene([zid, str(res["count"]), loc_s, res["incident_type"]], frm, name, hops, path)
    for i, p in enumerate(res["people"]):
        cid = vid if i == 0 and not zid else f"{vid}{i}"
        age = {"child": "C", "senior": "S"}.get(p["age_group"], "A")
        extras = ";".join(x for x in (f"INC:{zid}" if zid else "", f"NT:{(p['note'] or res['summary'])[:60]}",
                                       f"AI:{out['source']}") if x and not x.endswith(":"))
        h_report([cid, str(sos_ai.triage_of(p)), p["complaint"], age, str(res["count"]), sos_ai.flags_of(p), loc_s, "", extras],
                 frm, name, hops, path)
    S.setdefault("voice", []).append({"id": vid, "time": now_s(), "text": text, "source": out["source"], "result": res})


PRIORITY_ITEMS = ("O2", "INSULIN", "EPIPEN", "INHALER", "SEIZURE", "CPAPPWR")
ASK_WINDOW_S = float(os.environ.get("MEDMESH_PHARM_WINDOW", "90"))
ITEM_HINTS = {"INSULIN": "insulin", "INHALER": "inhaler|salbutamol|asthma|copd", "EPIPEN": "epipen|epinephrine|anaphyla",
              "HEART": "heart|apixaban|warfarin|bisoprolol", "SEIZURE": "epilep|seizure", "BP": "pressure|hypertension",
              "O2": "oxygen", "CPAPPWR": "cpap|bipap|oxygen", "STRIPS": "diabet|insulin", "NEB": "nebul|asthma|copd"}


def verified_need(item, profile):
    """Is this item consistent with the person's MedMesh ID? (Not proof, a priority signal.)"""
    if not profile:
        return False
    text = " ".join(str(x) for k in ("conditions", "meds", "devices") for x in (profile.get(k) or [])).lower()
    return bool(ITEM_HINTS.get(item) and re.search(ITEM_HINTS[item], text))


def h_med(f, frm, name, hops, path):
    # M|id|item|urgency(N=now,D=24h,3=3 days)|travel(1/0)|lat,lon|medmeshID
    rid, item, urg, travel = f[0], f[1], f[2], f[3] == "1"
    loc = (parse_latlon(f[4]) if len(f) > 4 else None) or S["layout"]["FIELD"]
    mid = (f[5] if len(f) > 5 else "").upper()
    profile = PROFILES.get(mid)
    send(f"A|{rid}|OK", frm, "ack")
    # one open request per person per item (the MedMesh ID ties the request to a person)
    if mid:
        for o in S["requests"].values():
            if o["mid"] == mid and o["item"] == item and o["status"] in ("asking", "pending", "ready"):
                send(f"MA|{rid}|DUP|0|{1 if travel else 0}|You already have an open request for this ({o['id']}).", frm, "pharmacy")
                return
    r = {"id": rid, "time": now_s(), "ts": time.time(), "from": name, "from_id": frm, "item": item, "urg": urg, "travel": travel,
         "loc": loc, "mid": mid, "profile": profile, "verified": verified_need(item, profile),
         "status": "asking", "tried": [], "asked": [], "answers": {}, "events": []}
    r["events"].append(f"{now_s()} request: {MED_NAMES.get(item, item)}" + (" · on their MedMesh ID" if r["verified"] else " · not on a MedMesh ID"))
    S["requests"][rid] = r
    route_request(r)
    send_demand(loc)


def fair_price(p, item):
    base, pr = BASE_PRICES.get(item), price_of(p, item)
    return not base or pr is None or pr <= base * (1 + PRICE_CAP_PCT / 100)


def pick_pharmacies(item, loc, exclude=(), k=3):
    """Nearest places that have it, fair-priced ones first: an over-cap seller is only asked when no fair one has stock."""
    opts = [(haversine_m(loc, (p["lat"], p["lon"])), p) for p in S["pharmacies"]
            if p["open"] and p["id"] not in exclude and p["stock"].get(item, 0) >= 1]
    fair = [o for o in opts if fair_price(o[1], item)]
    return [p for _, p in sorted(fair or opts, key=lambda x: x[0])[:k]]


def route_request(r):
    """Ask up to 3 places at once (one radio message names all of them), then pick the best answer."""
    places = pick_pharmacies(r["item"], r["loc"], r["tried"])
    if not places:
        return no_supply(r)
    ids = [p["id"] for p in places]
    r.update({"status": "asking", "asked": ids, "answers": {}, "asked_at": time.time()})
    r["tried"] += ids
    r["events"].append(f"{now_s()} asked {', '.join(p['name'] for p in places)} at once")
    km = ",".join(f"{haversine_m(r['loc'], (p['lat'], p['lon'])) / 1000:.1f}" for p in places)
    # the person's MedMesh ID stays at the command centre: pharmacies only learn whether the need matches it (verified)
    msg = f"MR|{r['id']}|{r['item']}|{r['urg']}|{1 if r['travel'] else 0}||{','.join(ids)}|{km}|{1 if r['verified'] else 0}"
    targets = [t for pid in ids for t in nodes_with_role("pharmacy", pid)]
    if targets:
        send(msg, None, "pharmacy")    # one broadcast on the private channel reaches every named place
    send(f"H|{r['id']}|WAIT|0|Asked {len(ids)} nearby place{'s' if len(ids) > 1 else ''}. Waiting for answers.", r["from_id"], "pharmacy")


def no_supply(r):
    r["status"] = "unavailable"
    r["events"].append(f"{now_s()} nobody nearby has {r['item']}")
    if r["item"] == "O2":
        text = "No supplier nearby has oxygen right now. If breathing gets harder or you have under 2 hours left, send an SOS now."
    elif r["urg"] == "N" and r["item"] in PRIORITY_ITEMS:
        r["events"].append("critical + out now: escalate to medical team")
        text = "Nobody nearby has it right now. The medical team has been told. If symptoms start, send an SOS."
    else:
        text = "Nobody nearby has it right now. We will tell you if that changes."
    send(f"MA|{r['id']}|NONE|0|0|{text}", r["from_id"], "pharmacy")


def h_pharm_answer(f, frm, name, hops, path):
    # PA|reqid|OK/NO|minutes      the pharmacy is identified by its node's role (J|X|MSP|...)
    r = S["requests"].get(f[0])
    pid = S["roles"].get(frm, {}).get("ref")
    if r:
        pharmacy_answer(r, f[1] == "OK", int(f[2]) if len(f) > 2 and f[2].isdigit() else 30, pid)


def pharmacy_answer(r, ok, minutes=30, pid=None):
    if r["status"] != "asking":
        return
    pid = pid if pid in r["asked"] else next((p for p in r["asked"] if p not in r["answers"]), None)
    if not pid:
        return
    r["answers"][pid] = {"ok": bool(ok), "minutes": minutes, "t": time.time()}
    r["events"].append(f"{now_s()} {pharm(pid)['name']}: {'has it' if ok else 'no'}")
    if len(r["answers"]) == len(r["asked"]):
        finalize_request(r)


def request_priority(r):
    """Who gets scarce stock first: out-now before later, oxygen/insulin dependants, on their MedMesh ID, then first asked."""
    return ({"N": 0, "D": 1, "3": 2}.get(r["urg"], 2), 0 if r["item"] in PRIORITY_ITEMS and r["verified"] else 1,
            0 if r["verified"] else 1, r["ts"])


def finalize_request(r):
    if r["status"] != "asking":
        return
    yes = []
    for pid, a in r["answers"].items():
        p = pharm(pid)
        if a["ok"] and p["stock"].get(r["item"], 0) >= 1:
            km = haversine_m(r["loc"], (p["lat"], p["lon"])) / 1000
            yes.append((km + a["minutes"] / 10 if r["travel"] else a["minutes"], pid, a["minutes"]))
    if not yes:
        r["events"].append(f"{now_s()} no place could hold it, trying others")
        return route_request(r)
    _, pid, minutes = min(yes)
    p = pharm(pid)
    p["stock"][r["item"]] = max(0, p["stock"].get(r["item"], 0) - 1)
    code = "".join(random.choices("ACDEFGHJKMNPQRTUVWXY3479", k=4))
    r.update({"status": "ready", "pharmacy": pid, "pharmacy_name": p["name"], "code": code})
    others = [x for x in r["answers"] if x != pid and r["answers"][x]["ok"]]
    for t in nodes_with_role("pharmacy", pid):
        send(f"MK|{r['id']}|{code}|{minutes}", t, "pharmacy")
    for o in others:
        for t in nodes_with_role("pharmacy", o):
            send(f"MX|{r['id']}", t, "pharmacy")
    how = "pickup" if r["travel"] else "delivery"
    r["events"].append(f"{now_s()} chose {p['name']} ({how}, code {code})" + (f"; told {len(others)} other(s) it is taken" if others else ""))
    if r["travel"]:
        rt = NET.route(r["loc"], (p["lat"], p["lon"]), set(S["blocked"]), S["floods"])
        msg = f"MA|{r['id']}|{pid}|{minutes}|1|{p['name']} is holding it for you. Show code {code}. Ready in {minutes} min" + (f", {rt['eta']} min away" if rt else "")
    else:
        msg = f"MA|{r['id']}|{pid}|{minutes}|0|{p['name']} will send it with the next responder (~{minutes} min). Code {code}"
        for t in nodes_with_role("responder"):
            send(f"T|{r['id']}|{pid}|{r['item']}|{r['loc'][0]:.4f},{r['loc'][1]:.4f}", t, "task")
    send(msg, r["from_id"], "pharmacy")


def pharmacy_loop():
    """Close each request's answer window; in the simulator, places with no device online answer from their stock."""
    while True:
        time.sleep(2)
        try:
            with LOCK:
                now = time.time()
                due = []
                for r in S["requests"].values():
                    if r.get("status") != "asking":
                        continue
                    if S.get("mode") == "sim":
                        for pid in r["asked"]:
                            if pid not in r["answers"] and not nodes_with_role("pharmacy", pid) and now - r["asked_at"] > 3 + hash(pid) % 5:
                                ok = pharm(pid)["stock"].get(r["item"], 0) >= 1
                                r["answers"][pid] = {"ok": ok, "minutes": 10 + hash(pid + r["id"]) % 15, "t": now, "sim": True}
                                r["events"].append(f"{now_s()} {pharm(pid)['name']}: {'has it' if ok else 'no'} (simulated reply)")
                    if len(r["answers"]) == len(r["asked"]) or now - r["asked_at"] > ASK_WINDOW_S:
                        due.append(r)
                for r in sorted(due, key=request_priority):   # scarce stock goes to the most urgent first
                    finalize_request(r)
            if due:
                push()
        except Exception as ex:
            log("err", "pharm", f"pharmacy loop: {ex!r}", kind="error")


def h_where(f, frm, name, hops, path):
    # Q|id|complaint|lat,lon
    qid, comp = f[0], f[1]
    loc = (parse_latlon(f[2]) if len(f) > 2 else None) or S["layout"]["FIELD"]
    best, rows, relaxed, _ = decide({"id": qid, "complaint": comp, "triage": 3, "age": "A", "loc": loc}, loc, onboard=True)
    send(f"A|{qid}|OK", frm, "ack")
    if best:
        send(f"W|{qid}|{best['id']}|{best['eta']}|{best['name']}|{short_route(best['route']['roads'])}", frm, "where")
    else:
        send(f"W|{qid}|NONE|0|No open site reachable right now", frm, "where")


DEMAND_KM = 5.0
DEMAND_H = 6
SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def demand_for(pid, now=None):
    """What people near this pharmacy asked for recently, anonymous: per item asked/unmet, and per compass sector near/far.
    No names, IDs or addresses leave the command centre, only counts."""
    p = pharm(pid)
    now = now or time.time()
    items, sectors = {}, {}
    rows = [(r["loc"], r["item"], 1, r["status"] == "unavailable", r["ts"]) for r in S["requests"].values()]
    for sp in S["supplies"].values():
        h = hosp(sp["hospital"])
        if h:
            rows.append(((h["lat"], h["lon"]), sp["item"], sp["qty"], sp["short"] > 0, sp.get("ts", now)))
    for loc, item, qty, unmet, ts in rows:
        if now - ts > DEMAND_H * 3600:
            continue
        d = haversine_m((p["lat"], p["lon"]), loc) / 1000
        if d > DEMAND_KM:
            continue
        a, u = items.get(item, (0, 0))
        items[item] = (a + qty, u + (qty if unmet else 0))
        dy, dx = loc[0] - p["lat"], (loc[1] - p["lon"]) * math.cos(math.radians(p["lat"]))
        sec = SECTORS[int(((math.degrees(math.atan2(dx, dy)) + 360 + 22.5) % 360) // 45)]
        near, far = sectors.get(sec, (0, 0))
        sectors[sec] = (near + 1, far) if d < 1.5 else (near, far + 1)
    return items, sectors


def send_demand(loc):
    """ND|pharmID|hours|ITEM:asked/unmet,...|SECTOR:near/far,...   to every pharmacy device within range of a new request."""
    for p in S["pharmacies"]:
        if haversine_m((p["lat"], p["lon"]), loc) / 1000 > DEMAND_KM:
            continue
        nodes = nodes_with_role("pharmacy", p["id"])
        if not nodes:
            continue
        items, sectors = demand_for(p["id"])
        it = ",".join(f"{k}:{a}/{u}" for k, (a, u) in sorted(items.items(), key=lambda x: -x[1][0]))
        se = ",".join(f"{k}:{n}/{f}" for k, (n, f) in sectors.items())
        for t in nodes:
            send(fit(f"ND|{p['id']}|{DEMAND_H}|{it}|{se}"), t, "demand")


PHARM_REPLIES = {"READY": "ready for pickup", "RUNNER": "is sending a runner", "OUT": "can't supply it after all", "DONE": "handed it over"}


def h_pharm_reply(f, frm, name, hops, path):
    # PR|id|READY / RUNNER / PART:n / OUT / DONE     a pharmacy's quick reply about a hospital order or a held request
    rid, what = f[0], (f[1] if len(f) > 1 else "READY")
    pid = S["roles"].get(frm, {}).get("ref")
    p = pharm(pid) if pid else None
    send(f"A|{rid}|OK", frm, "ack")
    if not p:
        return
    text = f"only {what[5:]} available" if what.startswith("PART:") else PHARM_REPLIES.get(what, what.lower())
    sp = S["supplies"].get(rid)
    if sp:
        sp.setdefault("replies", {})[pid] = what
        log("supply", p["name"], f"{sp['item']} for {sp['hospital']}: {text}")
        for hn in nodes_with_role("hospital", sp["hospital"]):
            send(f"SU|{rid}|{pid}|{what}", hn, "supply")
        return
    r = S["requests"].get(rid)
    if r and r.get("pharmacy") == pid:
        r["events"].append(f"{now_s()} {p['name']} {text}")
        if what == "DONE":
            r["status"] = "collected"
        elif what == "OUT":                    # held stock turned out to be gone: try the other places
            r.update({"status": "asking", "pharmacy": None, "code": None})
            p["stock"][r["item"]] = 0
            route_request(r)


PRICE_CAP_PCT = float(os.environ.get("MEDMESH_PRICE_CAP_PCT", "10"))


def price_of(p, item):
    own = (p.get("prices") or {}).get(item)
    return own if own is not None else EMERGENCY_PRICES.get(p["id"], {}).get(item)


def price_check(item):
    """Fair-price rule: during the emergency an offer may be at most normal price + PRICE_CAP_PCT."""
    base = BASE_PRICES.get(item)
    cap = round(base * (1 + PRICE_CAP_PCT / 100), 2) if base else None
    offers = []
    for p in S["pharmacies"]:
        pr = price_of(p, item)
        if pr is None:
            continue
        pct = round(100 * (pr / base - 1), 1) if base else 0.0
        offers.append({"pharm": p["id"], "name": p["name"], "price": pr, "stock": p["stock"].get(item, 0), "open": p["open"],
                       "within": cap is None or pr <= cap, "pct": pct})
    return {"item": item, "base": base, "cap": cap, "offers": offers}


def h_supply(f, frm, name, hops, path):
    # S|id|hospID|item|qty[|ALLOW]   hospital asks for supplies; places above the price cap are skipped and flagged.
    # ALLOW = the hospital knowingly accepts over-cap offers for a critical shortage; recorded in the audit log.
    sid, hid, item, qty = f[0], f[1], f[2], int(f[3])
    allow = len(f) > 4 and f[4] == "ALLOW"
    h = hosp(hid) or {"lat": 43.78, "lon": -79.22, "name": hid}
    pc = price_check(item)
    over_all = [o for o in pc["offers"] if not o["within"] and o["stock"] > 0 and o["open"]]
    over = [] if allow else over_all
    fair = [dict(p, stock={**p["stock"], item: 0}) if any(o["pharm"] == p["id"] for o in over) else p for p in S["pharmacies"]]
    secs = ENG.router.times_from((h["lat"], h["lon"]), {p["id"]: (p["lat"], p["lon"]) for p in S["pharmacies"]},
                                 set(S["blocked"]), S["floods"])
    plan = plan_supply({item: qty}, fair, {k: (v / 60 if v is not None else None) for k, v in secs.items()})
    alloc, cost = [], 0.0
    for pid, items in plan["allocation"].items():
        take = items.get(item, 0)
        if not take:
            continue
        pharm(pid)["stock"][item] -= take
        pr = price_of(pharm(pid), item) or 0.0
        cost += pr * take
        alloc.append((pid, take, pr))
        for t in nodes_with_role("pharmacy", pid):
            send(f"SR|{sid}|{hid}|{item}|{take}", t, "supply")
    left = plan["shortfall"].get(item, 0)
    fair_cost = round((pc["base"] or 0) * sum(a[1] for a in alloc), 2)
    for o in over:
        flag = {"time": now_s(), "pharm": o["pharm"], "name": o["name"], "item": item, "price": o["price"], "base": pc["base"],
                "cap": pc["cap"], "pct": o["pct"], "supply": sid}
        S.setdefault("price_flags", []).append(flag)
        log("price", o["name"], f"{item} at ${o['price']:.2f} is {o['pct']:.0f}% above normal (cap {PRICE_CAP_PCT:.0f}%): skipped", kind="alert")
    S["supplies"][sid] = {"id": sid, "time": now_s(), "ts": time.time(), "hospital": hid, "item": item, "qty": qty, "alloc": [(a, n) for a, n, _ in alloc],
                          "prices": {a: pr for a, _, pr in alloc}, "cost": round(cost, 2), "fair_cost": fair_cost,
                          "flagged": [o["pharm"] for o in over], "short": left, "status": "allocated" if alloc else "unavailable", "plan": plan}
    AUDIT.append("supply", {"id": sid, "hospital": hid, "order": {item: qty}, "plan": plan, "cost": round(cost, 2),
                            "price_cap_pct": PRICE_CAP_PCT, "skipped_over_cap": [(o["pharm"], o["price"]) for o in over],
                            "accepted_over_cap": [(o["pharm"], o["price"]) for o in over_all] if allow else []})
    send_demand((h["lat"], h["lon"]))
    if allow and over_all:
        log("price", hid, f"{hid} accepted over-cap {item} from {', '.join(o['name'] for o in over_all)} (critical shortage, logged)", kind="alert")
    send(f"A|{sid}|OK", frm, "ack")
    send(fit(f"SA|{sid}|" + ",".join(f"{a}:{n}@{pr:.2f}" for a, n, pr in alloc) + f"|short:{left}|cost:{cost:.2f}|over:"
             + ",".join(f"{o['pharm']}@{o['price']:.2f}" for o in over)), frm, "supply")


def h_hospital_ack(f, frm, name, hops, path):
    # HA|caseid|READY or FULL     the receiving hospital confirms it is ready, or says it is full (divert others)
    c = S["cases"].get(f[0])
    what = f[1] if len(f) > 1 else "READY"
    hid = S["roles"].get(frm, {}).get("ref") or (c or {}).get("hospital")
    send(f"A|{f[0]}|OK", frm, "ack")
    if c and what == "READY":
        c["hospital_ready"] = now_s()
        c["events"].append(f"{now_s()} {c.get('hospital_name')} is ready for this patient")
    elif what == "FULL" and hosp(hid):
        hosp(hid)["open"] = False
        log("hospital", name, f"{hosp(hid)['name']} is full: diverting new patients", kind="alert")
        AUDIT.append("hospital_full", {"hospital": hid, "via": name})
        # ambulances still on the way to a patient (not carrying them yet) are sent to another hospital
        for x in list(S["cases"].values()):
            if x.get("hospital") == hid and x["status"] in ("dispatched", "no_route"):
                x["events"].append(f"{now_s()} {hosp(hid)['name']} reported full")
                assign(x, reroute=True)
        reroute_all(f"{hosp(hid)['name']} reported full")


def incoming_update(c, what, eta=0, hid=None):
    """IU|caseid|PK/ARR/AWAY|eta   keeps the receiving hospital's Incoming screen current."""
    for hn in nodes_with_role("hospital", hid or c.get("hospital")):
        send(f"IU|{c['id']}|{what}|{eta}", hn, "incoming")


HANDLERS = {"PR": h_pharm_reply, "HA": h_hospital_ack, "RD": h_road, "Z": h_scene, "V": h_voice, "O": h_checkin, "K": h_slow, "L": h_loc, "J": h_join, "R": h_report, "U": h_status, "B": h_block, "F": h_flood, "C": h_hospital,
            "P": h_pharm, "M": h_med, "PA": h_pharm_answer, "Q": h_where, "S": h_supply}


# ------------------------------------------------------------------ background: simulated ambulances (sim mode)
SIM_SPEEDUP = 8  # simulated seconds per real second, so a trip takes ~1 minute on screen


def _walk(coords, d):
    """Point at distance d (m) along a polyline; returns (lat, lon, done)."""
    for a, b in zip(coords, coords[1:]):
        L = haversine_m(a, b)
        if d <= L and L > 0:
            t = d / L
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, False
        d -= L
    return coords[-1][0], coords[-1][1], True


def sim_ambulances():
    last = time.time()
    while True:
        time.sleep(1)
        now = time.time(); dt = (now - last) * SIM_SPEEDUP; last = now
        if not S.get("sim_amb", True):
            continue
        try:
            with LOCK:
                for c in list(S["cases"].values()):
                    if c["status"] not in ("dispatched", "picked_up") or not c.get("route"):
                        continue
                    a = S["ambulances"].get(c["id"])
                    if not a:
                        a = S["ambulances"][c["id"]] = {"node": "AMB-" + c["id"], "case": c["id"], "d": 0.0, "phase": "pickup",
                                                        "lat": S["ems"]["lat"], "lon": S["ems"]["lon"], "simt": now}
                    rt = c["pickup_route"] if a["phase"] == "pickup" else c["route"]
                    if not rt:
                        a["phase"] = "hospital"; continue
                    lat, lon, _ = _walk(rt["coords"], a["d"])
                    edges = [NET.edges[i] for i in rt["edges"]] or NET.edges
                    e = min(edges, key=lambda e: min(haversine_m((lat, lon), p) for p in e["geom"]))
                    kmh = e["speed"] / S["sim_traffic"].get(e["name"], 1.0)
                    a["d"] += kmh / 3.6 * dt
                    lat, lon, done = _walk(rt["coords"], a["d"])
                    a["simt"] = a.get("simt", now) + dt
                    learn(a["node"], lat, lon, a["simt"], c["id"])
                    ambulance_update(c, lat, lon)
                    if done and a["phase"] == "pickup":
                        a.update({"phase": "hospital", "d": 0.0})
                        c["status"] = "picked_up"; c["t_pickup"] = time.time(); c["events"].append(f"{now_s()} ambulance reached patient")
                        send(f"H|{c['id']}|PK|{c['eta']}|Paramedics have the patient, going to {c['hospital_name']}", c["from_id"], "help")
                        ambulance_update(c, lat, lon, force=True)
                        notify_contact(c, "picked_up")
                        incoming_update(c, "PK", c.get("eta") or 0)
                    elif done:
                        c["status"] = "delivered"; c["t_arrive"] = time.time(); c["events"].append(f"{now_s()} arrived at {c['hospital_name']}")
                        send(f"H|{c['id']}|ARR|0|Arrived at {c['hospital_name']}. The team there is expecting you.", c["from_id"], "help")
                        notify_contact(c, "arrived")
                        incoming_update(c, "ARR", 0)
                        S["ambulances"].pop(c["id"], None)
            push()
        except Exception as ex:
            log("err", "sim", f"ambulance sim: {ex!r}", kind="error")


# ------------------------------------------------------------------ background: node health
def health_loop():
    while True:
        try:
            with LOCK:
                fresh = {n["id"]: n for n in BRIDGE.nodes()}
                changed = {k: v["online"] for k, v in fresh.items()} != {k: v["online"] for k, v in S["nodes"].items()}
                for nid, n in fresh.items():
                    n["role"] = S["roles"].get(nid, {}).get("role")
                S["nodes"] = fresh
            if changed:
                push()
        except Exception:
            pass
        time.sleep(3)


# ------------------------------------------------------------------ web app
app = FastAPI(title="MedMesh Command Centre")
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/api/profile")
def api_profile(body: dict = Body(...)):
    """Pre-disaster sync: the app uploads an opt-in medical profile while internet/LAN is available."""
    mid = str(body.get("id", "")).upper()[:6]
    if len(mid) != 6:
        return {"ok": False, "error": "bad id"}
    prof = {k: body.get(k) for k in ("name", "age", "sex", "blood", "allergies", "conditions", "meds", "contact",
                                      "devices", "home_hospital", "risk_flags", "address", "lives_alone", "mobility", "communication", "labs", "watch")}
    for k in ("allergies", "conditions", "meds", "devices", "risk_flags", "communication", "labs"):
        v = prof.get(k)
        prof[k] = [x.strip() for x in v.split(",") if x.strip()] if isinstance(v, str) else (v or [])
    try:
        prof["age"] = int(prof["age"]) if prof.get("age") not in (None, "") else None
    except (TypeError, ValueError):
        prof["age"] = None
    prof["watch"] = prof.get("watch") is True        # opted in to the vulnerable-persons registry (area counts + wellness checks)
    home = parse_latlon(str(body.get("home") or ""))   # only kept when they opted in
    prof["home"] = list(home) if (home and prof["watch"]) else None
    prof["updated"] = datetime.now().strftime("%Y-%m-%d")
    with LOCK:
        PROFILES[mid] = prof
        db.execute("INSERT OR REPLACE INTO profiles VALUES(?,?,?)", (mid, json.dumps(prof), time.time()))
        db.commit()
    return {"ok": True, "id": mid}


@app.get("/api/profiles/demo")
def api_demo_profiles():
    return [{"id": k, "name": v["name"], "age": v["age"]} for k, v in PROFILES.items()]


@app.get("/")
def root():
    return FileResponse(os.path.join(HERE, "static", "dashboard.html"))


@app.get("/app")
def app_redirect():
    return RedirectResponse("/app/")


@app.get("/api/state")
def api_state():
    return json.loads(json.dumps(snapshot(), default=str))


@app.get("/api/map")
def api_map():
    return NET.geo()


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()
    CLIENTS.add(sock)
    await sock.send_text(json.dumps({"type": "state", "state": snapshot()}, default=str))
    try:
        while True:
            await sock.receive_text()
    except WebSocketDisconnect:
        CLIENTS.discard(sock)


def mutate(fn):
    with LOCK:
        out = fn()
    push()
    return out or {"ok": True}


@app.post("/api/hospital/{hid}")
def api_hospital(hid: str, body: dict = Body(...)):
    def f():
        h = hosp(hid)
        before_open = h["open"]
        for k in ("free", "icu", "total", "caps", "open"):
            if k in body:
                h[k] = body[k]
        h["updated"] = f"{now_s()} dashboard"
        if "er_wait" in body:
            h["er_wait"] = body["er_wait"]
        ENG.report(hid, free=h["free"] if "free" in body else None, wait=body.get("er_wait"))
        if before_open and not h["open"]:
            for c in S["cases"].values():
                if c.get("hospital") == hid and c["status"] in ("dispatched", "en_route", "picked_up"):
                    c["events"].append(f"{now_s()} {h['name']} closed")
                    assign(c, reroute=True)
    return mutate(f)


@app.post("/api/pharmacy/{pid}")
def api_pharmacy(pid: str, body: dict = Body(...)):
    def f():
        p = pharm(pid)
        if "open" in body: p["open"] = body["open"]
        for k, v in (body.get("stock") or {}).items(): p["stock"][k] = int(v)
    return mutate(f)


@app.post("/api/request/{rid}")
def api_request(rid: str, body: dict = Body(...)):
    return mutate(lambda: pharmacy_answer(S["requests"][rid], body.get("ok", True), body.get("minutes", 30), body.get("pharmacy")))


RUN_STARTED = time.time()


def review_data():
    from engine import review
    with LOCK:
        rows = db.execute("SELECT ts, dir, node, text, hops FROM messages WHERE ts >= ?", (RUN_STARTED,)).fetchall()
        metrics = review.compute(S, rows)
    return metrics, review


@app.get("/api/review")
def api_review():
    """After-incident review: metrics from our own records (no names / IDs) + findings that must cite them."""
    metrics, review = review_data()
    return {"generated": datetime.now().isoformat(timespec="minutes"), "metrics": metrics, "review": review.findings(metrics)}


@app.get("/review")
def review_page():
    return FileResponse(os.path.join(HERE, "static", "review.html"))


@app.get("/api/prices")
def api_prices():
    """Fair-price board for hospitals: normal price, cap, and each place's emergency price."""
    return {"cap_pct": PRICE_CAP_PCT, "items": {k: price_check(k) for k, v in BASE_PRICES.items() if v},
            "flags": S.get("price_flags", [])[-30:], "note": "Demo prices"}


@app.post("/api/pack")
def api_pack(body: dict = Body(...)):
    """Personal offline emergency pack (called by the app at MedMesh ID setup, while online).
    Body: {language, items: [{id, text}], voice: [ids]}. Gemini translates + voices; numbers are checked."""
    from engine import pack_ai
    try:
        return pack_ai.build_pack(str(body.get("language", "English"))[:40], body.get("items") or [], body.get("voice") or [])
    except Exception as e:  # keep the app working: it falls back to English + the phone's voice
        return {"source": "none", "error": f"Gemini unavailable: {type(e).__name__}", "items": [], "audio": {}}


@app.post("/api/interpret")
def api_interpret(body: dict = Body(...)):
    """The phone's 'tell us in your own words' box: any language, text or recorded audio -> the emergency form."""
    return sos_ai.interpret(text=str(body.get("text", ""))[:2000] or None, audio=body.get("audio"), mime=body.get("mime"))


@app.post("/api/block")
def api_block(body: dict = Body(...)):
    def f():
        road = body["road"]
        if body.get("clear"):
            S["blocked"] = [r for r in S["blocked"] if r != road]
            return
        if road not in S["blocked"]:
            S["blocked"].append(road)
        reroute_all(f"{road} blocked (command centre)")
    return mutate(f)


@app.post("/api/flood")
def api_flood(body: dict = Body(...)):
    def f():
        if body.get("clear"):
            S["floods"] = []
            return
        S["floods"].append({"lat": body["lat"], "lon": body["lon"], "r": body.get("r", 400)})
        reroute_all("flood zone drawn by command centre")
    return mutate(f)


@app.post("/api/alert")
def api_alert(body: dict = Body(...)):
    return mutate(lambda: broadcast_alert(str(body.get("text", ""))[:150], body.get("level", "INFO")))


HAZARD_TYPES = ("STORM", "RAIN", "FLOOD", "SNOW", "FIRE", "QUAKE", "HEAT", "NONE")


def broadcast_hazard(kind, severity="WARN", area=""):
    """X|type|severity|area  - tells every phone on the mesh which disaster is active, so the app can show it offline."""
    kind = kind.upper() if kind and kind.upper() in HAZARD_TYPES else "NONE"
    S["hazard"] = None if kind == "NONE" else {"type": kind, "severity": severity, "area": area[:40], "t": now_s(),
                                               "set_at": datetime.now().isoformat(timespec="seconds")}
    send(fit(f"X|{kind}|{severity}|{area[:40]}"), None, "hazard")


@app.get("/api/hazard")
def api_hazard():
    return S.get("hazard") or {"type": "NONE"}


@app.post("/api/hazard")
def api_set_hazard(body: dict = Body(...)):
    return mutate(lambda: broadcast_hazard(str(body.get("type", "NONE")), str(body.get("severity", "WARN"))[:6], str(body.get("area", ""))))


@app.get("/api/track/{cid}")
def api_track(cid: str):
    """Simulator / same-network only: live ambulance position for the patient's tracking map.
    (Over the real mesh the phone gets ETA updates as H| messages instead.)"""
    with LOCK:
        c = S["cases"].get(cid)
        if not c:
            return {"ok": False}
        h = hosp(c.get("hospital")) if c.get("hospital") else None
        a = S["ambulances"].get(cid) or {}
        return json.loads(json.dumps({"ok": True, "status": c["status"], "eta": c.get("eta"), "pickup_eta": c.get("pickup_eta"),
                "loc": c["loc"], "hospital": {"id": h["id"], "name": h["name"], "lat": h["lat"], "lon": h["lon"]} if h else None,
                "amb": {"lat": a.get("lat"), "lon": a.get("lon"), "kmh": a.get("kmh"), "road": a.get("road"), "phase": a.get("phase")} if a.get("lat") else None,
                "route": (c.get("route") or {}).get("coords"), "pickup": (c.get("pickup_route") or {}).get("coords"),
                "events": c.get("events", [])[-6:]}, default=str))


@app.post("/api/slow")
def api_slow(body: dict = Body(...)):
    return mutate(lambda: set_slow(body["road"], 1.0 if body.get("clear") else float(body.get("factor", 3)), body.get("reason", "command centre"), "command centre"))


@app.post("/api/sim/traffic")
def api_sim_traffic(body: dict = Body(...)):
    """Simulator only: a hidden traffic jam. The base doesn't know about it until ambulances drive into it."""
    def f():
        if body.get("clear"):
            S["sim_traffic"] = {}
        else:
            S["sim_traffic"][body["road"]] = float(body.get("factor", 4))
    return mutate(f)


@app.post("/api/sim/ambulances")
def api_sim_amb(body: dict = Body(...)):
    return mutate(lambda: S.update({"sim_amb": bool(body.get("on", True))}))


@app.post("/api/case/{cid}/flag/{i}")
def api_flag(cid: str, i: int):
    def f():
        fl = S["cases"][cid]["flags"][i]
        fl["ack"] = not fl["ack"]
    return mutate(f)


@app.post("/api/case/{cid}/status")
def api_case_status(cid: str, body: dict = Body(...)):
    return mutate(lambda: h_status([cid, body["status"]], "dashboard", "dashboard", 0, None))


@app.post("/api/summary")
def api_summary():
    out = ai.summary(snapshot())
    with LOCK:
        S["summary"] = {**out, "t": now_s()}
    push()
    return S["summary"]


@app.get("/api/engine")
def api_engine():
    """Live state of the dispatch engine: per-facility queue model and bed nowcast, router and audit stats."""
    with LOCK:
        return {"facilities": ENG.snapshot(), "stats": ENG.stats, "router": ENG.router.stats,
                "audit": {"records": AUDIT.count, "head": AUDIT.head}}


@app.get("/api/decision/{cid}")
def api_decision(cid: str):
    """Full decision record for one case: every facility, every factor, eliminations and the explanation."""
    with LOCK:
        c = S["cases"].get(cid)
        return (c or {}).get("decision") or {"error": "no decision for this case"}


@app.post("/api/engine/batch")
def api_batch():
    """Mass-casualty mode: jointly re-optimise all active cases and compare with first-come-first-served."""
    with LOCK:
        active = [c for c in S["cases"].values() if c["status"] in ("dispatched", "no_route") and c.get("loc")]
        for c in active:
            ENG.release(c["id"])
        out = ENG.optimize_batch([{**c, "loc": tuple(c["loc"])} for c in active],
                                 set(S["blocked"]), S["floods"], units_available())
        for c in active:   # restore commitments of the current plan
            if c.get("decision"):
                ENG.commit(c["decision"])
        AUDIT.append("batch", {k: v for k, v in out.items()})
        return out


@app.get("/api/audit")
def api_audit(n: int = 50):
    return {"verify": AUDIT.verify(), "tail": AUDIT.tail(n)}


@app.post("/api/reset")
def api_reset():
    def f():
        global RUN_STARTED
        RUN_STARTED = time.time()
        S.update({"hospitals": copy.deepcopy(HOSPITALS), "pharmacies": copy.deepcopy(PHARMACIES), "cases": {},
                  "requests": {}, "supplies": {}, "blocked": [], "floods": [], "log": [], "summary": None})
        SEEN.clear()
        S.update({"slow": {}, "traffic": [], "ambulances": {}, "sim_traffic": {}, "traffic_events": [], "alerts": [], "checkins": [], "incidents": {}, "notifications": [], "road_reports": []})
        NET.slow.clear(); NET.live.clear()
        global ENG, DEDUP
        ENG, DEDUP = Engine(NET, S["hospitals"]), DuplicateDetector()
        if isinstance(BRIDGE, SimBridge):
            BRIDGE.outbox.clear()
            for n in BRIDGE.online: BRIDGE.online[n] = True
    return mutate(f)


# ---- simulator endpoints (sim mode only): virtual phones + node failures
# ---------------------------------------------------------------- government / emergency management (read-only)
from engine import gov as GOV
WATCH_REGISTRY = GOV.seed_registry() if os.environ.get("MEDMESH_DEMO_REGISTRY", "1") == "1" else []
_GOV_SEEN = {}


def gov_log(view, who):
    """Every government look at the data goes into the hash-chained audit log (at most once per view per 10 min per user)."""
    k = (view, who)
    if time.time() - _GOV_SEEN.get(k, 0) > 600:
        _GOV_SEEN[k] = time.time()
        AUDIT.append("gov_access", {"view": view, "who": who[:60]})


def gov_nodes():
    pos = dict(NODE_LAYOUT)
    if isinstance(BRIDGE, SimBridge):
        return [{"id": n, "online": up, "lat": pos.get(n, (None, None))[0], "lon": pos.get(n, (None, None))[1]}
                for n, up in BRIDGE.online.items() if n in pos]
    try:
        return [{"id": n["id"], "online": n.get("online", True), "lat": n.get("lat"), "lon": n.get("lon")} for n in BRIDGE.nodes()]
    except Exception:
        return []


@app.get("/api/gov/overview")
def gov_overview(who: str = "government"):
    gov_log("overview", who)
    with LOCK:
        return GOV.overview(S, gov_nodes())


@app.get("/api/gov/watchlist")
def gov_watchlist(who: str = "government"):
    gov_log("watchlist", who)
    with LOCK:
        return GOV.watchlist(S, PROFILES, WATCH_REGISTRY, gov_nodes(), RUN_STARTED)


@app.post("/api/gov/wellness")
def gov_wellness(body: dict = Body(...)):
    """Send responders to check on a silent person. The government screen only knows the token; responders get the place."""
    token = str(body.get("token", ""))[:8]
    with LOCK:
        home, needs = GOV.locate(token, S, PROFILES, WATCH_REGISTRY)
        if not home:
            return {"ok": False, "error": "unknown token"}
        wid = new_id("w")
        AUDIT.append("wellness_check", {"id": wid, "token": token, "area": GOV.area_of(home), "who": str(body.get("who", ""))[:60]})
        log("watch", "Government", f"wellness check {wid} requested for {token} ({GOV.AREA[GOV.area_of(home)]['name']})", kind="alert")
        targets = nodes_with_role("responder")
        for t in targets:
            send(f"WC|{wid}|{home[0]:.4f},{home[1]:.4f}|{'+'.join(needs)}", t, "task")
    push()
    return {"ok": True, "id": wid, "responders": len(targets)}


@app.post("/api/gov/mitigation")
def gov_mitigation(body: dict = Body(default={})):
    gov_log("mitigation", str((body or {}).get("who", "government")))
    with LOCK:
        wl = GOV.watchlist(S, PROFILES, WATCH_REGISTRY, gov_nodes(), RUN_STARTED)
        ov = GOV.overview(S, gov_nodes())
    deck = GOV.mitigation(wl, ov)
    AUDIT.append("mitigation_deck", {"source": deck["source"], "slides": len(deck["slides"])})
    return {"generated": datetime.now().isoformat(timespec="minutes"), **deck}


@app.get("/api/gov/analysis")
def gov_analysis(who: str = "government"):
    """Post-disaster analysis: review metrics + a timeline + response by area (de-identified)."""
    gov_log("analysis", who)
    metrics, _ = review_data()
    with LOCK:
        cases = [c for c in S["cases"].values() if c.get("status") != "merged"]
        t0 = min([c["ts"] for c in cases if c.get("ts")], default=RUN_STARTED)
        span = max([c.get("ts", t0) for c in cases], default=t0) - t0
        bin_s = 60 if span < 1800 else 600          # short drills in 1-minute bins, real events in 10-minute bins
        bins = {}
        for c in cases:
            b = int((c.get("ts", t0) - t0) // bin_s)
            row = bins.setdefault(b, {"bin": b, "1": 0, "2": 0, "3": 0, "4": 0})
            row[str(c.get("triage") or 2)] = row.get(str(c.get("triage") or 2), 0) + 1
        by_area = {}
        for c in cases:
            a = by_area.setdefault(GOV.area_of(c.get("loc")), {"cases": 0, "dispatch": [], "arrive": []})
            a["cases"] += 1
            if c.get("t_dispatch"): a["dispatch"].append(c["t_dispatch"] - c["ts"])
            if c.get("t_arrive"): a["arrive"].append((c["t_arrive"] - c["ts"]) / 60)
    med = lambda xs: round(sorted(xs)[len(xs) // 2], 1) if xs else None  # noqa: E731
    return {"generated": datetime.now().isoformat(timespec="minutes"), "metrics": metrics,
            "timeline": [bins[k] for k in sorted(bins)], "bin_min": bin_s // 60,
            "areas": [{"id": k, "name": GOV.AREA[k]["name"], "cases": v["cases"], "dispatch_sec": med(v["dispatch"]), "arrive_min": med(v["arrive"])}
                      for k, v in sorted(by_area.items(), key=lambda x: -x[1]["cases"])]}


@app.get("/api/gov/export.csv")
def gov_export(who: str = "government"):
    """De-identified case table for analysts (no names, no MedMesh IDs, area instead of exact place)."""
    import csv, io
    from fastapi.responses import Response
    gov_log("export", who)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["case", "time", "area", "triage", "complaint", "age_group", "hospital", "dispatch_sec", "arrive_min", "reroutes", "status"])
    with LOCK:
        for c in S["cases"].values():
            w.writerow([c["id"], c.get("time"), GOV.AREA[GOV.area_of(c.get("loc"))]["name"], c.get("triage"), c.get("complaint"), c.get("age"),
                        c.get("hospital"), round(c["t_dispatch"] - c["ts"], 1) if c.get("t_dispatch") else "",
                        round((c["t_arrive"] - c["ts"]) / 60, 1) if c.get("t_arrive") else "", c.get("reroutes", 0), c.get("status")])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=medmesh-cases.csv"})


@app.post("/api/sim/send")
def sim_send(body: dict = Body(...)):
    if not isinstance(BRIDGE, SimBridge):
        return {"ok": False, "error": "not in sim mode"}
    p = BRIDGE.inject(body.get("node", "FIELD"), body["text"])
    if not p:
        with LOCK:
            log("drop", body.get("node", "FIELD"), body["text"], kind="undelivered")
        push()
    return {"ok": bool(p), "path": p}


@app.get("/api/sim/inbox/{node}")
def sim_inbox(node: str, since: float = 0):
    if not isinstance(BRIDGE, SimBridge):
        return []
    return [m for m in BRIDGE.outbox if m["node"] == node and m["ts"] > since and m["delivered"]]


@app.post("/api/sim/node/{node}")
def sim_node(node: str, body: dict = Body(...)):
    if isinstance(BRIDGE, SimBridge):
        BRIDGE.online[node] = bool(body.get("online", not BRIDGE.online[node]))
    return {"ok": True}


@app.post("/api/sim/scenario")
def sim_scenario():
    """Fire a few realistic demo reports at once."""
    msgs = [("FIELD", f"J|P||Shelter A"),
            ("FIELD", f"R|{new_id()}|1|CP|A|1|0F10|43.7712,-79.1931|MX4K9P|"),
            ("FIELD", f"R|{new_id()}|2|FX|S|1|0N10|43.7650,-79.2100||BG:A+;AL:none"),
            ("FIELD", f"M|{new_id()}|INSULIN|N|0|43.7700,-79.2000|"),
            ("FIELD", f"R|{new_id()}|1|BR|C|1|0F10|43.7900,-79.1900|HV3N8R|")]
    for i, (n, m) in enumerate(msgs):
        threading.Timer(i * 1.2, lambda n=n, m=m: BRIDGE.inject(n, m)).start()
    return {"ok": True}


app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")
APP_DIR = os.path.join(ROOT, "app")
if os.path.isdir(APP_DIR):
    app.mount("/app", StaticFiles(directory=APP_DIR, html=True), name="app")


@app.on_event("startup")
async def startup():
    global LOOP
    LOOP = asyncio.get_running_loop()
    S["ai"] = ai.available()


def main():
    global BRIDGE
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", action="store_true", help="run without hardware (simulated 4-node mesh)")
    ap.add_argument("--port", default=None, help="serial port of the BASE board (auto-detect if omitted)")
    ap.add_argument("--http", type=int, default=8000)
    a = ap.parse_args()
    if a.sim:
        BRIDGE = SimBridge(); S["mode"] = "sim"
        # the demo starts in a disaster: a thunderstorm warning over Scarborough (MEDMESH_DEMO_HAZARD=NONE to start calm;
        # the test kit can switch it to snow, flood, wildfire or all clear)
        hz = os.environ.get("MEDMESH_DEMO_HAZARD", "STORM").upper()
        if hz in HAZARD_TYPES and hz != "NONE":
            S["hazard"] = {"type": hz, "severity": "WARN", "area": "Scarborough", "t": now_s(), "set_at": datetime.now().isoformat(timespec="seconds")}
    else:
        BRIDGE = SerialBridge(a.port); S["mode"] = "mesh"
    # ship the same offline area map with the phone app (deployed with app/, cached for offline use)
    try:
        with open(os.path.join(APP_DIR, "area.json"), "w") as f:
            json.dump(NET.geo(), f, separators=(",", ":"))
    except Exception as e:
        print("could not write app/area.json:", e)
    BRIDGE.start(on_text)
    if hasattr(BRIDGE, "on_position"):
        BRIDGE.on_position = on_position
    threading.Thread(target=health_loop, daemon=True).start()
    threading.Thread(target=pharmacy_loop, daemon=True).start()
    if a.sim:
        threading.Thread(target=sim_ambulances, daemon=True).start()
    print(f"\n  MedMesh command centre ({S['mode']} mode, roads: {NET.source})\n  Dashboard: http://localhost:{a.http}\n  App:       http://localhost:{a.http}/app/\n")
    uvicorn.run(app, host="0.0.0.0", port=a.http, log_level="warning")


if __name__ == "__main__":
    main()
