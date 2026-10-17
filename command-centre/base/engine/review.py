"""After-incident review: the numbers come from the command centre's own records; Gemini writes findings that must cite them.

compute()   deterministic metrics from cases, decisions, messages, roads, supplies, contacts (no names, no MedMesh IDs)
findings()  Gemini (JSON schema) turns metrics into findings + recommendations + next drill. Every finding must cite
            evidence keys that exist in the metrics; findings that cite nothing real are dropped. Without a key or
            internet, fixed rules produce the findings instead.
"""
import json
import os
import re
import statistics
import urllib.error
import urllib.request
from collections import Counter

API = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")   # override only for tests
COMPLAINT = {"CP": "chest pain", "BR": "breathing", "BL": "bleeding/injury", "BU": "burn", "UN": "unconscious",
             "PR": "pregnancy", "FX": "fall/fracture", "OT": "other"}


def _med(xs):
    return round(statistics.median(xs), 1) if xs else None


def compute(S, messages):
    """S: command-centre state. messages: [(ts, dir, node, text, hops)] from the message database."""
    cases = [c for c in S["cases"].values() if c.get("status") != "merged"]
    merged = [c for c in S["cases"].values() if c.get("status") == "merged"]
    m = {"cases": {}, "hospitals": {}, "diversions": [], "roads": {}, "mesh": {}, "supplies": {}, "contacts": {}, "scenes": {}}

    # ---- cases and response
    dec_s = [c["t_dispatch"] - c["ts"] for c in cases if c.get("t_dispatch") and c.get("ts")]
    pick = [c["pickup_eta"] for c in cases if isinstance(c.get("pickup_eta"), (int, float)) and c.get("hospital")]
    ttt = []
    for c in cases:
        rec = c.get("decision") or {}
        ch = next((r for r in rec.get("candidates", []) if r.get("id") == rec.get("chosen")), None)
        if ch and ch.get("time_to_treatment") is not None:
            ttt.append(ch["time_to_treatment"])
            ok = [r for r in rec["candidates"] if r.get("eligible") and r.get("drive_min") is not None]
            if ok:
                nearest = min(ok, key=lambda r: r["drive_min"])
                if nearest["id"] != ch["id"]:
                    m["diversions"].append({"case": c["id"], "nearest": nearest["id"], "chosen": ch["id"],
                                            "extra_drive_min": round(ch["drive_min"] - nearest["drive_min"], 1),
                                            "why": (rec.get("explain") or [""])[0][:140]})
    m["cases"] = {
        "total": len(cases), "duplicates_merged": len(merged),
        "by_triage": dict(Counter(str(c.get("triage")) for c in cases)),
        "by_complaint": dict(Counter(COMPLAINT.get(c.get("complaint"), "other") for c in cases)),
        "status": dict(Counter(c.get("status") for c in cases)),
        "no_route": [c["id"] for c in cases if c.get("status") == "no_route"],
        "reroutes": sum(c.get("reroutes", 0) for c in cases),
        "decision_seconds_median": _med(dec_s), "pickup_eta_min_median": _med(pick), "time_to_treatment_min_median": _med(ttt),
        "with_medmesh_id": sum(1 for c in cases if c.get("profile")),
        "rows": [{"id": c["id"], "triage": c.get("triage"), "complaint": c.get("complaint"), "hospital": c.get("hospital"),
                  "pickup_eta": c.get("pickup_eta"), "eta": c.get("eta"), "status": c.get("status")} for c in cases][:40],
    }
    # ---- hospitals
    sent = Counter(c.get("hospital") for c in cases if c.get("hospital"))
    for h in S["hospitals"]:
        cap = h.get("total") or (h.get("free", 0) + sent.get(h["id"], 0))
        m["hospitals"][h["id"]] = {"name": h["name"], "patients_sent": sent.get(h["id"], 0), "free_beds_now": h.get("free"),
                                   "capacity": cap, "open": h.get("open", True),
                                   "load_pct": round(100 * (1 - (h.get("free", 0) / cap)), 0) if cap else None}
    # ---- roads
    reps = S.get("road_reports", [])
    m["roads"] = {"blocked": list(S.get("blocked", [])), "flood_zones": len(S.get("floods", [])),
                  "slow": {k: v.get("reason") for k, v in S.get("slow", {}).items()},
                  "citizen_reports": len(reps), "citizen_confirmed": sum(1 for r in reps if r.get("confirmed")),
                  "most_reported": Counter(r["road"] for r in reps if r.get("road")).most_common(3)}
    # ---- mesh
    inbound = [x for x in messages if x[1] == "in"]
    hops = [x[4] for x in inbound if isinstance(x[4], int)]
    m["mesh"] = {"messages_in": len(inbound), "messages_out": sum(1 for x in messages if x[1] == "out"),
                 "undelivered": sum(1 for x in messages if x[1] == "drop"),
                 "hops": dict(Counter(hops)), "multi_hop_share": round(sum(1 for h in hops if h >= 2) / len(hops), 2) if hops else 0,
                 "bytes_total": sum(len((x[3] or "").encode()) for x in messages),
                 "by_node": dict(Counter(x[2] for x in inbound).most_common(6))}
    # ---- supplies
    reqs = list(S.get("requests", {}).values())
    m["supplies"] = {"requests": len(reqs), "by_item": dict(Counter(r["item"] for r in reqs)),
                     "unavailable": dict(Counter(r["item"] for r in reqs if r.get("status") == "unavailable")),
                     "fulfilled": sum(1 for r in reqs if r.get("status") == "ready"),
                     "on_medmesh_id": sum(1 for r in reqs if r.get("verified"))}
    # ---- contacts and scenes
    ns = S.get("notifications", [])
    m["contacts"] = {"texts": len(ns), "sent": sum(1 for n in ns if n["status"] == "sent"),
                     "queued": sum(1 for n in ns if str(n["status"]).startswith("queued"))}
    inc = S.get("incidents", {})
    m["scenes"] = {"count": len(inc), "people": sum(z.get("count", 0) for z in inc.values()),
                   "with_danger": sum(1 for z in inc.values() if z.get("hazards"))}
    m["checkins"] = dict(Counter(x.get("status") for x in S.get("checkins", [])))
    return m


def evidence_keys(m):
    """Every citable thing in the metrics: section names, case ids, hospital ids, roads, items."""
    keys = set(m.keys())
    keys |= {f"case:{r['id']}" for r in m["cases"]["rows"]}
    keys |= {f"hospital:{h}" for h in m["hospitals"]}
    keys |= {f"road:{r}" for r in m["roads"]["blocked"]} | {f"road:{r}" for r in m["roads"]["slow"]}
    keys |= {f"item:{i}" for i in m["supplies"]["by_item"]}
    return keys


SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "findings": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "detail": {"type": "string"}, "recommendation": {"type": "string"},
            "owner": {"type": "string", "description": "who acts: hospitals, EMS, pharmacies, city, mesh team"},
            "evidence": {"type": "array", "items": {"type": "string"}}},
            "required": ["title", "detail", "recommendation", "evidence"]}},
        "next_drill": {"type": "string"},
    },
    "required": ["headline", "findings", "next_drill"],
}
PROMPT = """You are writing an after-action review of a disaster response run by MedMesh (offline emergency coordination over
a LoRa radio mesh). Use ONLY the metrics below; do not invent numbers. 4 to 6 findings, most important first.
Each finding: what happened (with the numbers), why it matters, one concrete recommendation to prepare better, who should act,
and "evidence": keys from this list that support it: {keys}
Then "next_drill": one practice scenario to run next time that tests the weakest point.
Metrics (JSON):
{metrics}"""


def gemini_findings(m, key, model):
    keys = sorted(evidence_keys(m))[:200]
    body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(keys=", ".join(keys), metrics=json.dumps(m, default=str)[:30000])}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": SCHEMA, "temperature": 0.2}}
    req = urllib.request.Request(f"{API}/models/{model}:generateContent", data=json.dumps(body).encode(), method="POST",
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    raw = next((p["text"] for c in resp.get("candidates", []) for p in c.get("content", {}).get("parts", []) if p.get("text")), "{}")
    mm = re.search(r"\{.*\}", raw, re.S)
    return json.loads(mm.group(0) if mm else raw)


def rule_findings(m):
    f = []
    full = [(h, v) for h, v in m["hospitals"].items() if v["load_pct"] is not None and v["load_pct"] >= 85]
    if full:
        h, v = max(full, key=lambda x: x[1]["load_pct"])
        f.append({"title": f"{v['name']} ran close to full", "detail": f"{v['patients_sent']} patients sent, {v['load_pct']:.0f}% of beds in use.",
                  "recommendation": "Put extra beds on standby there earlier in the next event.", "owner": "hospitals", "evidence": ["hospitals", f"hospital:{h}"]})
    if m["diversions"]:
        extra = round(sum(d["extra_drive_min"] for d in m["diversions"]) / len(m["diversions"]), 1)
        n = len(m["diversions"])
        f.append({"title": f"{n} patient{'s' if n != 1 else ''} went past the nearest hospital",
                  "detail": f"On average {extra} more minutes of driving, chosen because care would start sooner there (waits, beds or specialist care).",
                  "recommendation": "Share live bed and wait updates more often so the nearest hospital can be used more.", "owner": "hospitals",
                  "evidence": ["diversions"] + [f"case:{d['case']}" for d in m["diversions"][:3]]})
    if m["roads"]["blocked"] or m["roads"]["flood_zones"]:
        roads = ", ".join(m["roads"]["blocked"][:3]) or "reported spots"
        f.append({"title": "Roads closed during the response", "detail": f"Blocked: {roads}. Flood zones: {m['roads']['flood_zones']}. Reroutes: {m['cases']['reroutes']}.",
                  "recommendation": "Place a water-level sensor node on the most-hit road and pre-plan detours.", "owner": "city",
                  "evidence": ["roads"] + [f"road:{r}" for r in m["roads"]["blocked"][:2]]})
    if m["supplies"]["unavailable"]:
        item, n = max(m["supplies"]["unavailable"].items(), key=lambda x: x[1])
        f.append({"title": f"{item.title()} ran out", "detail": f"{n} request(s) for {item} could not be filled nearby.",
                  "recommendation": f"Stock more {item.lower()} in the affected area before the next storm.", "owner": "pharmacies",
                  "evidence": ["supplies", f"item:{item}"]})
    if m["mesh"]["undelivered"] or m["mesh"]["multi_hop_share"] > 0.4:
        f.append({"title": "Parts of the area depended on long radio relays",
                  "detail": f"{int(m['mesh']['multi_hop_share'] * 100)}% of messages needed 2+ hops; {m['mesh']['undelivered']} were not delivered.",
                  "recommendation": "Add a relay node where messages needed the most hops.", "owner": "mesh team", "evidence": ["mesh"]})
    if m["contacts"]["queued"]:
        f.append({"title": "Family texts waited for a connection", "detail": f"{m['contacts']['queued']} of {m['contacts']['texts']} texts to emergency contacts were queued.",
                  "recommendation": "Give the command centre a backup internet link (satellite or a second carrier).", "owner": "EMS", "evidence": ["contacts"]})
    if not f:
        f.append({"title": "Response ran smoothly", "detail": f"{m['cases']['total']} cases handled.", "recommendation": "Run a harder drill.", "owner": "EMS", "evidence": ["cases"]})
    drill = "Repeat this event with the busiest hospital closed and its main road flooded."
    nb = len(m["roads"]["blocked"])
    return {"headline": f"{m['cases']['total']} people helped, {len(m['diversions'])} diverted, {nb} road{'s' if nb != 1 else ''} closed", "findings": f[:6], "next_drill": drill}


def findings(m):
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        try:
            g = gemini_findings(m, key, os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"))
            valid = evidence_keys(m)
            kept = []
            for x in g.get("findings", [])[:6]:
                ev = [e for e in x.get("evidence", []) if e in valid]
                if ev:   # a finding that cites nothing real is dropped
                    kept.append({**x, "evidence": ev})
            if kept:
                return {"source": "gemini", "headline": g.get("headline", ""), "findings": kept, "next_drill": g.get("next_drill", ""),
                        "dropped": len(g.get("findings", [])) - len(kept)}
        except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as e:
            out = rule_findings(m)
            return {"source": "rules", "note": f"Gemini unavailable ({type(e).__name__})", **out}
    return {"source": "rules", **rule_findings(m)}
