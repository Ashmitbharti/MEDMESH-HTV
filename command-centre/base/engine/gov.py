"""Government / emergency-management view of MedMesh: read-only, de-identified, every access logged by the caller.

areas        approximate Scarborough neighbourhoods (centroids); every case, request and person is counted by area
overview()   what is happening now: cases by triage per area, hospital capacity and freshness, supplies, roads, mesh health
watchlist()  people who OPTED IN on their MedMesh ID and depend on something fragile (oxygen, CPAP, dialysis, insulin,
             living alone with limited mobility). Government sees area counts and risk, never names. A person who has
             gone silent (no check-in, report or request for a while) appears as an anonymous token that can be sent to
             responders for a wellness visit; only responders get the location.
mitigation() a planning deck: Gemini writes actions per area that must cite the facts below (area:/need:/node: keys);
             actions citing nothing real are dropped. Without Gemini, fixed rules write the deck.
"""
import hashlib
import json
import math
import os
import random
import re
import time
import urllib.error
import urllib.request

API = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")   # override only for tests
SILENT_MIN = float(os.environ.get("MEDMESH_SILENT_MIN", "180"))     # dependent + no contact this long = check on them

# Approximate neighbourhood centres (for grouping only; not official boundaries)
AREAS = [
    ("HCR", "Highland Creek", 43.784, -79.187), ("MSD", "Morningside", 43.790, -79.205), ("MLV", "Malvern", 43.807, -79.222),
    ("WOB", "Woburn", 43.767, -79.228), ("SCV", "Scarborough Village", 43.739, -79.215), ("BND", "Bendale", 43.760, -79.257),
    ("AGC", "Agincourt", 43.787, -79.281), ("WHL", "West Hill", 43.768, -79.180), ("RGE", "Rouge", 43.805, -79.180),
    ("GWD", "Guildwood", 43.750, -79.195),
]
NEEDS = {
    "O2": {"label": "Home oxygen", "weight": 3, "hint": r"oxygen|copd"},
    "CPAP": {"label": "CPAP / powered device", "weight": 3, "hint": r"cpap|bipap|ventilat|powered|wheelchair"},
    "DIAL": {"label": "Dialysis", "weight": 3, "hint": r"dialys|kidney"},
    "INSULIN": {"label": "Insulin", "weight": 2, "hint": r"insulin|type 1"},
    "ALONE": {"label": "Lives alone, limited mobility", "weight": 2, "hint": ""},
}


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def area_of(loc):
    if not loc:
        return "HCR"
    return min(AREAS, key=lambda a: haversine_km(loc, (a[2], a[3])))[0]


AREA = {a[0]: {"id": a[0], "name": a[1], "lat": a[2], "lon": a[3]} for a in AREAS}


# ---------------------------------------------------------------- synthetic opt-in registry (demo)
def seed_registry(n=46, seed=7):
    """Synthetic opt-in people for the demo (NOT real people). Each: area, home point, needs, minutes since last contact."""
    rnd = random.Random(seed)
    weights = {"MLV": 9, "MSD": 6, "WOB": 6, "SCV": 5, "BND": 4, "AGC": 4, "HCR": 3, "WHL": 4, "RGE": 2, "GWD": 3}
    pool = [a for a, w in weights.items() for _ in range(w)]
    out = []
    for i in range(n):
        a = AREA[rnd.choice(pool)]
        needs = rnd.sample(["O2", "CPAP", "DIAL", "INSULIN"], k=1 if rnd.random() < 0.75 else 2)
        if rnd.random() < 0.4:
            needs.append("ALONE")
        last = rnd.choice([15, 25, 40, 60, 90, 120, 150, 240, 330]) if rnd.random() < 0.95 else None
        out.append({"token": f"W{i:03d}", "area": a["id"], "home": (a["lat"] + rnd.uniform(-0.008, 0.008), a["lon"] + rnd.uniform(-0.01, 0.01)),
                    "needs": needs, "last_min_ago": last, "synthetic": True})
    return out


def needs_of(profile):
    text = " ".join(str(x) for k in ("conditions", "meds", "devices") for x in (profile.get(k) or [])).lower()
    out = [k for k, v in NEEDS.items() if v["hint"] and re.search(v["hint"], text)]
    if profile.get("lives_alone") and str(profile.get("mobility", "")).lower() not in ("", "on my own", "independent", "no help needed"):
        out.append("ALONE")
    return out


def token_of(mid):
    return "P" + hashlib.sha256(("medmesh-watch:" + mid).encode()).hexdigest()[:5].upper()


# ---------------------------------------------------------------- overview
def overview(S, nodes, now=None):
    now = now or time.time()
    areas = {k: {**v, "cases": {"1": 0, "2": 0, "3": 0, "4": 0}, "active": 0, "requests": 0, "unmet": 0, "checkins": 0} for k, v in AREA.items()}
    cases = [c for c in S["cases"].values() if c.get("status") != "merged"]
    for c in cases:
        a = areas[area_of(c.get("loc"))]
        a["cases"][str(c.get("triage") or 2)] = a["cases"].get(str(c.get("triage") or 2), 0) + 1
        if c.get("status") not in ("delivered", "resolved", "merged"):
            a["active"] += 1
    for r in S["requests"].values():
        a = areas[area_of(r.get("loc"))]
        a["requests"] += 1
        a["unmet"] += r.get("status") == "unavailable"
    for ch in S.get("checkins", []):
        if ch.get("loc"):
            areas[area_of(ch["loc"])]["checkins"] += 1
    dispatch = [c["t_dispatch"] - c["ts"] for c in cases if c.get("t_dispatch") and c.get("ts")]
    arrive = [(c["t_arrive"] - c["ts"]) / 60 for c in cases if c.get("t_arrive") and c.get("ts")]
    hospitals = [{"id": h["id"], "name": h["name"], "lat": h["lat"], "lon": h["lon"], "free": h["free"], "total": h["total"], "icu": h["icu"],
                  "open": h["open"], "er_wait": h.get("er_wait"), "updated": h.get("updated")} for h in S["hospitals"]]
    sup = list(S["supplies"].values())
    return {
        "generated": now, "areas": list(areas.values()), "hospitals": hospitals, "nodes": nodes,
        "totals": {
            "cases": len(cases), "active": sum(a["active"] for a in areas.values()),
            "by_triage": {k: sum(a["cases"][k] for a in areas.values()) for k in ("1", "2", "3", "4")},
            "delivered": sum(1 for c in cases if c.get("status") == "delivered"),
            "dispatch_sec_median": round(sorted(dispatch)[len(dispatch) // 2], 1) if dispatch else None,
            "arrive_min_median": round(sorted(arrive)[len(arrive) // 2], 1) if arrive else None,
            "requests": len(S["requests"]), "unmet": sum(a["unmet"] for a in areas.values()),
            "supplies": len(sup), "supplies_short": sum(1 for s in sup if s.get("short")), "price_flags": len(S.get("price_flags", [])),
            "roads_closed": len(S["blocked"]), "flood_zones": len(S["floods"]), "checkins": len(S.get("checkins", [])),
            "beds_free": sum(h["free"] for h in S["hospitals"] if h["open"]), "beds_total": sum(h["total"] for h in S["hospitals"]),
            "hospitals_closed": sum(1 for h in S["hospitals"] if not h["open"]),
            "nodes_down": sum(1 for n in nodes if not n["online"]),
        },
        "roads": list(S["blocked"])[:10],
        "alerts": [a["text"] for a in S.get("alerts", [])[-5:]],
    }


# ---------------------------------------------------------------- watchlist
def last_contact(S, mid):
    """Most recent sign of life from this MedMesh ID: a check-in, an SOS report or a medicine request (epoch seconds)."""
    ts = [c.get("ts", 0) for c in S["cases"].values() if c.get("mid") == mid]
    ts += [r.get("ts", 0) for r in S["requests"].values() if r.get("mid") == mid]
    ts += [c.get("ts", 0) for c in S.get("checkins", []) if c.get("mid") == mid]
    return max(ts) if ts else None


def watchlist(S, profiles, registry, nodes, started, now=None):
    now = now or time.time()
    people = []
    for mid, p in profiles.items():                      # real synced profiles that opted in
        if not p.get("watch") or not p.get("home"):
            continue
        needs = needs_of(p)
        if not needs:
            continue
        lc = last_contact(S, mid)
        people.append({"token": token_of(mid), "area": area_of(p["home"]), "home": p["home"], "needs": needs,
                       "silent_min": round((now - (lc or started)) / 60), "synthetic": False})
    for r in registry:                                    # synthetic demo registry
        silent = r["last_min_ago"] if r["last_min_ago"] is not None else (now - started) / 60 + 360
        people.append({**r, "silent_min": round(silent)})

    online = [n for n in nodes if n["online"] and n.get("lat") is not None]
    def nearest_node_km(loc):
        return min((haversine_km(loc, (n["lat"], n["lon"])) for n in online), default=99)

    o2 = [p for p in S["pharmacies"] if p["open"] and p["stock"].get("O2", 0) > 0]
    ins = [p for p in S["pharmacies"] if p["open"] and p["stock"].get("INSULIN", 0) > 0]
    dial = [h for h in S["hospitals"] if h["open"] and "D" in h.get("caps", "")]
    supply_for = {"O2": o2, "CPAP": o2, "INSULIN": ins, "DIAL": dial}

    areas = {}
    for k, a in AREA.items():
        loc = (a["lat"], a["lon"])
        cov = round(nearest_node_km(loc), 1)
        gaps = {need: round(min((haversine_km(loc, (s["lat"], s["lon"])) for s in src), default=99), 1) for need, src in supply_for.items()}
        areas[k] = {**a, "people": 0, "silent": 0, "needs": {n: 0 for n in NEEDS}, "node_km": cov, "supply_km": gaps, "risk": 0.0, "factors": []}
    silent = []
    for p in people:
        a = areas[p["area"]]
        a["people"] += 1
        for n in p["needs"]:
            a["needs"][n] += 1
        w = sum(NEEDS[n]["weight"] for n in p["needs"])
        is_silent = p["silent_min"] >= SILENT_MIN
        far = sum(1 for n in p["needs"] if n in a["supply_km"] and a["supply_km"][n] > 5)
        a["risk"] += w * (1 + 0.5 * far + (1 if a["node_km"] > 2.5 else 0) + (1 if is_silent else 0))
        if is_silent:
            a["silent"] += 1
            silent.append({"token": p["token"], "area": p["area"], "area_name": a["name"], "needs": p["needs"],
                           "silent_h": round(p["silent_min"] / 60, 1), "synthetic": p.get("synthetic", False)})
    for a in areas.values():
        a["risk"] = round(a["risk"], 1)
        if a["node_km"] > 2.5:
            a["factors"].append(f"nearest working radio node {a['node_km']} km away")
        for n, km in a["supply_km"].items():
            if a["needs"].get(n) and km > 5:
                a["factors"].append(f"no {NEEDS[n]['label'].lower()} supply within 5 km")
        if a["silent"]:
            a["factors"].append(f"{a['silent']} dependent people not heard from in {int(SILENT_MIN / 60)}+ h")
    ranked = sorted(areas.values(), key=lambda a: -a["risk"])
    return {"generated": now, "silent_after_min": SILENT_MIN, "people": len(people), "areas": ranked, "nodes": nodes,
            "silent": sorted(silent, key=lambda s: -s["silent_h"])[:40],
            "totals": {n: sum(a["needs"][n] for a in ranked) for n in NEEDS}, "needs": {k: v["label"] for k, v in NEEDS.items()},
            "note": "Opt-in only. Area counts and anonymous tokens; names and homes go only to responders for a wellness visit."}


def locate(token, S, profiles, registry):
    """Responder-only: where to go for a wellness visit (never returned to the government screen)."""
    for mid, p in profiles.items():
        if p.get("watch") and p.get("home") and token_of(mid) == token:
            return p["home"], needs_of(p)
    for r in registry:
        if r["token"] == token:
            return r["home"], r["needs"]
    return None, []


# ---------------------------------------------------------------- mitigation deck
def facts(wl, ov):
    top = [a for a in wl["areas"] if a["people"]][:6]
    f = {"areas": [{"key": f"area:{a['id']}", "name": a["name"], "risk": a["risk"], "people": a["people"], "silent": a["silent"],
                    "needs": {k: v for k, v in a["needs"].items() if v}, "nearest_node_km": a["node_km"],
                    "nearest_supply_km": {k: v for k, v in a["supply_km"].items() if a["needs"].get(k)}, "factors": a["factors"]} for a in top],
         "totals": wl["totals"], "people": wl["people"],
         "response": {k: ov["totals"].get(k) for k in ("cases", "active", "unmet", "supplies_short", "nodes_down", "hospitals_closed", "beds_free", "beds_total")},
         "nodes": [{"key": f"node:{n['id']}", "online": n["online"]} for n in ov["nodes"]]}
    keys = {a["key"] for a in f["areas"]} | {f"need:{k}" for k, v in wl["totals"].items() if v} | {n["key"] for n in f["nodes"]} | {"response"}
    return f, keys


SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "slides": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "area": {"type": "string", "description": "area key, e.g. area:MLV, or empty for city-wide"},
            "problem": {"type": "string"},
            "actions": {"type": "array", "items": {"type": "object", "properties": {
                "action": {"type": "string"}, "owner": {"type": "string"}, "when": {"type": "string", "description": "before / during / after"},
                "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["action", "owner", "when", "evidence"]}}},
            "required": ["title", "problem", "actions"]}},
    },
    "required": ["headline", "summary", "slides"],
}
PROMPT = """You are an emergency-planning analyst for a city. Write a mitigation deck for the next disaster in which the phone
network fails. People below opted in to a vulnerable-persons registry; you only see counts per area, never individuals.
Use ONLY these facts; do not invent numbers. 4 to 6 slides, highest-risk first; the last slide can be city-wide.
Each slide: the problem (with the numbers), 2-4 concrete actions, who owns each (city, public health, hospitals, pharmacies,
oxygen suppliers, mesh team, community volunteers), when (before / during / after), and "evidence": keys from this list: {keys}
Facts (JSON):
{facts}"""


def gemini_deck(f, keys, key, model):
    body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(keys=", ".join(sorted(keys)), facts=json.dumps(f)[:20000])}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": SCHEMA, "temperature": 0.3}}
    req = urllib.request.Request(f"{API}/models/{model}:generateContent", data=json.dumps(body).encode(), method="POST",
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    raw = next((p["text"] for c in resp.get("candidates", []) for p in c.get("content", {}).get("parts", []) if p.get("text")), "{}")
    mm = re.search(r"\{.*\}", raw, re.S)
    return json.loads(mm.group(0) if mm else raw)


def rule_deck(f):
    slides = []
    for a in f["areas"][:4]:
        acts = []
        if a["nearest_node_km"] > 2.5:
            acts.append({"action": f"Install a solar relay node in {a['name']} (nearest working node is {a['nearest_node_km']} km away).", "owner": "mesh team", "when": "before", "evidence": [a["key"]]})
        if a["needs"].get("O2") or a["needs"].get("CPAP"):
            n = a["needs"].get("O2", 0) + a["needs"].get("CPAP", 0)
            acts.append({"action": f"Pre-stage {max(2, n // 2)} oxygen cylinders and a generator charging point in {a['name']} for {n} oxygen/powered-device users.", "owner": "oxygen suppliers", "when": "before", "evidence": [a["key"], "need:O2" if a["needs"].get("O2") else "need:CPAP"]})
        if a["needs"].get("DIAL"):
            acts.append({"action": f"Give {a['needs']['DIAL']} dialysis patients in {a['name']} a backup dialysis slot and transport plan.", "owner": "hospitals", "when": "before", "evidence": [a["key"], "need:DIAL"]})
        if a["needs"].get("INSULIN"):
            acts.append({"action": f"Ask pharmacies near {a['name']} to hold a 3-day insulin buffer for {a['needs']['INSULIN']} registered users.", "owner": "pharmacies", "when": "before", "evidence": [a["key"], "need:INSULIN"]})
        if a["silent"] or a["needs"].get("ALONE"):
            acts.append({"action": f"Volunteer check-in rounds every 4 hours in {a['name']} once the network fails; start with people silent longest.", "owner": "community volunteers", "when": "during", "evidence": [a["key"]]})
        slides.append({"title": f"{a['name']}: {a['people']} people depend on power or supplies", "area": a["key"],
                       "problem": "; ".join(a["factors"]) or f"{a['people']} registered dependent people.", "actions": acts[:4]})
    slides.append({"title": "City-wide", "area": "", "problem": f"{f['people']} people on the opt-in registry.",
                   "actions": [{"action": "Run a registry sign-up drive at pharmacies and dialysis units before storm season.", "owner": "public health", "when": "before", "evidence": ["response"]},
                               {"action": "After each event, compare who went silent with who needed help and update the plan.", "owner": "city", "when": "after", "evidence": ["response"]}]})
    top = f["areas"][0]["name"] if f["areas"] else "the city"
    return {"headline": f"Protect the people who can't wait: start with {top}",
            "summary": f"{f['people']} opted-in people depend on oxygen, powered devices, dialysis or insulin. Actions below are ranked by area risk.",
            "slides": slides}


def mitigation(wl, ov):
    f, keys = facts(wl, ov)
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        try:
            g = gemini_deck(f, keys, key, os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"))
            slides, dropped = [], 0
            for s in g.get("slides", [])[:6]:
                acts = []
                for x in s.get("actions", [])[:4]:
                    ev = [e for e in x.get("evidence", []) if e in keys]
                    if ev:
                        acts.append({**x, "evidence": ev})
                    else:
                        dropped += 1          # an action citing nothing real is dropped
                if acts:
                    slides.append({**s, "actions": acts})
            if slides:
                return {"source": "gemini", "headline": g.get("headline", ""), "summary": g.get("summary", ""), "slides": slides,
                        "dropped": dropped, "facts": f}
        except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as e:
            return {"source": "rules", "note": f"Gemini unavailable ({type(e).__name__})", **rule_deck(f), "facts": f}
    return {"source": "rules", **rule_deck(f), "facts": f}
