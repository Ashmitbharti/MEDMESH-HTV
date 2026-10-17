"""MedMesh decision logic: protocol, triage, hospital scoring, routing."""
import json, math, os
import networkx as nx
from data import EW_ROADS, NS_ROADS

MAX_BYTES = 200  # keep every LoRa text comfortably under the Meshtastic payload limit

# ---------------------------------------------------------------- protocol
COMPLAINTS = {"CP": "Chest pain", "BR": "Breathing difficulty", "BL": "Bleeding / injury", "BU": "Burn",
              "UN": "Unconscious", "PR": "Pregnancy", "FX": "Fracture / fall", "OT": "Other"}
TRIAGE = {1: ("IMMEDIATE", "red"), 2: ("DELAYED", "yellow"), 3: ("MINOR", "green"), 4: ("EXPECTANT", "black")}
AGES = {"C": "Child", "A": "Adult", "S": "Senior"}
# capability a complaint REQUIRES (hard filter) and PREFERS (soft bonus)
NEEDS = {"CP": "C", "BU": "B", "PR": "O", "BL": "T", "FX": "T"}


def fit(msg: str) -> str:
    """Trim a message so its UTF-8 size fits one LoRa packet."""
    b = msg.encode()
    return msg if len(b) <= MAX_BYTES else b[:MAX_BYTES].decode(errors="ignore")


def parse(text: str):
    """Split a pipe message into (type, fields). Returns (None, []) for free text."""
    if "|" not in text:
        return None, []
    parts = text.strip().split("|")
    return parts[0].upper(), parts[1:]


def parse_latlon(s):
    try:
        a, b = s.split(",")
        return float(a), float(b)
    except Exception:
        return None


def parse_extras(s: str) -> dict:
    """'BG:O-;AL:PEN;CX:DM' -> dict"""
    out = {}
    for kv in (s or "").split(";"):
        if ":" in kv:
            k, v = kv.split(":", 1)
            out[k.strip().upper()] = v.strip()
    return out


# ---------------------------------------------------------------- triage (START)
def start_triage(walk: bool, breathing: str, responds: bool, bleeding: bool) -> int:
    """START rules. breathing in {'normal','fast','none'}"""
    if walk:
        return 3
    if breathing == "none":
        return 4
    if breathing == "fast" or bleeding or not responds:
        return 1
    return 2


# ---------------------------------------------------------------- geo helpers
def haversine_m(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# ---------------------------------------------------------------- road graph
def bearing(a, b):
    """Compass bearing in degrees from a to b (lat, lon)."""
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin(dl) * math.cos(la2)
    y = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def turn_word(delta):
    d = (delta + 540) % 360 - 180  # -180..180, positive = right
    if abs(d) < 25: return "Continue straight onto"
    if abs(d) > 150: return "Make a U-turn onto"
    side = "right" if d > 0 else "left"
    return ("Turn " if abs(d) >= 55 else "Keep slightly ") + side + " onto"


COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def seg_dist_m(p, a, b):
    """Distance in metres from point p to segment a-b (small-area flat approximation)."""
    kx = 111320 * math.cos(math.radians(p[0])); ky = 110540
    ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
    bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


class RoadNet:
    """Offline road graph + routing.
    Loads map.json (made by prepare_map.py from OpenStreetMap). Without it, builds a simplified
    grid of real Scarborough arterials so everything still runs.
    Edge weight = free-flow travel time x congestion factor, where congestion comes from
    'slow road' reports and from live ambulance speeds."""

    CLS_SPEED = {"motorway": 90, "trunk": 70, "primary": 60, "secondary": 50, "tertiary": 50, "residential": 40, "service": 20}

    def __init__(self, path=os.path.join(os.path.dirname(__file__), "map.json")):
        self.G = nx.Graph()
        self.edges = []      # index -> {u, v, name, cls, length, time, geom}
        self.areas = {"water": [], "parks": [], "buildings": []}
        if os.path.exists(path):
            self._load(path); self.source = "osm"
        else:
            self._grid(); self.source = "grid"
        self.road_names = sorted({e["name"] for e in self.edges if e["name"] != "unnamed road"})
        self.slow = {}       # road name -> factor (reports)
        self.live = {}       # edge index -> factor (learned from ambulance speeds)
        self.risk = {}       # edge index -> flood probability from the forecast (soft penalty)
        self.closed_edges = set()  # edge indices closed by the forecast (probability too high)

    # ---- building the graph
    def _edge(self, u, v, name, cls, speed=None, geom=None, length=None):
        pu, pv = self.G.nodes[u]["pos"], self.G.nodes[v]["pos"]
        geom = geom or [pu, pv]
        length = length or sum(haversine_m(a, b) for a, b in zip(geom, geom[1:]))
        speed = speed or self.CLS_SPEED.get(cls, 40)
        i = len(self.edges)
        self.edges.append({"i": i, "u": u, "v": v, "name": name, "cls": cls, "length": length,
                           "time": length / (speed / 3.6), "speed": speed, "geom": geom})
        self.G.add_edge(u, v, i=i)

    def _grid(self):
        for _, lat, _ in EW_ROADS:
            for _, lon, _, _ in NS_ROADS:
                self.G.add_node((lat, lon), pos=(lat, lon))
        lats = [r[1] for r in EW_ROADS]
        for name, lat, speed in EW_ROADS:
            for i in range(len(NS_ROADS) - 1):
                self._edge((lat, NS_ROADS[i][1]), (lat, NS_ROADS[i + 1][1]), name, "motorway" if speed >= 80 else "primary", speed)
        for name, lon, speed, ext in NS_ROADS:
            for i in range(len(lats) - 1):
                la, lb = lats[i], lats[i + 1]
                if ext and not (ext[0] - 1e-6 <= min(la, lb) and max(la, lb) <= ext[1] + 1e-6):
                    continue
                self._edge((la, lon), (lb, lon), name, "secondary" if speed < 50 else "primary", speed)
        self.G.remove_nodes_from([n for n in list(self.G.nodes) if self.G.degree(n) == 0])
        # stylised areas so the map isn't empty before prepare_map.py is run
        self.areas["water"] = [[(43.7950, -79.1960), (43.7880, -79.1890), (43.7800, -79.1870), (43.7720, -79.1830), (43.7650, -79.1760),
                                (43.7640, -79.1730), (43.7710, -79.1800), (43.7790, -79.1840), (43.7870, -79.1860), (43.7960, -79.1930)]]
        self.areas["parks"] = [[(43.7850, -79.2000), (43.7850, -79.1930), (43.7770, -79.1930), (43.7770, -79.2000)],
                               [(43.7560, -79.2320), (43.7560, -79.2200), (43.7480, -79.2200), (43.7480, -79.2320)],
                               [(43.8060, -79.2600), (43.8060, -79.2480), (43.8000, -79.2480), (43.8000, -79.2600)]]

    def _load(self, path):
        with open(path) as f:
            data = json.load(f)
        for n in data["nodes"]:
            self.G.add_node(n["id"], pos=(n["lat"], n["lon"]))
        for e in data["edges"]:
            geom = [tuple(p) for p in e.get("geom") or []] or None
            self._edge(e["u"], e["v"], e["name"], e.get("cls", "residential"), e.get("speed"), geom, e.get("length"))
        self.areas = {k: [[tuple(p) for p in poly] for poly in v] for k, v in data.get("areas", {}).items()}
        for k in ("water", "parks", "buildings"):
            self.areas.setdefault(k, [])

    # ---- congestion
    RISK_WEIGHT = 2.0  # p_flood = 0.5 -> road costs 2x its normal time

    def factor(self, e):
        return self.slow.get(e["name"], 1.0) * self.live.get(e["i"], 1.0) * (1.0 + self.RISK_WEIGHT * self.risk.get(e["i"], 0.0))

    def nearest_edge(self, p, max_m=60):
        best, bd = None, max_m
        for e in self.edges:
            g = e["geom"]
            for a, b in zip(g, g[1:]):
                d = seg_dist_m(p, a, b)
                if d < bd:
                    best, bd = e, d
        return best

    # ---- routing
    def view(self, blocked, floods):
        H = self.G.copy()
        H.remove_edges_from([(u, v) for u, v, d in H.edges(data=True)
                             if self.edges[d["i"]]["name"] in blocked or d["i"] in self.closed_edges])
        for fz in floods:
            c, r = (fz["lat"], fz["lon"]), fz["r"]
            H.remove_nodes_from([n for n in list(H.nodes) if haversine_m(H.nodes[n]["pos"], c) <= r])
        return H

    def nearest(self, latlon, H=None):
        H = H or self.G
        return min(H.nodes, key=lambda n: haversine_m(H.nodes[n]["pos"], latlon))

    def route(self, a_latlon, b_latlon, blocked=set(), floods=(), dest_name="destination"):
        """Fastest route by (congestion-adjusted) travel time.
        Returns {coords, eta, free_eta, roads, steps, edges, dist} or None if unreachable."""
        H = self.view(blocked, list(floods))
        if H.number_of_nodes() == 0:
            return None
        a, b = self.nearest(a_latlon, H), self.nearest(b_latlon, H)
        w = lambda u, v, d: self.edges[d["i"]]["time"] * self.factor(self.edges[d["i"]])
        try:
            path = nx.shortest_path(H, a, b, weight=w)
        except nx.NetworkXNoPath:
            return None
        coords, secs, free, dist, used = [tuple(a_latlon)], 0.0, 0.0, 0.0, []
        for u, v in zip(path, path[1:]):
            e = self.edges[H.edges[u, v]["i"]]
            g = e["geom"]
            if haversine_m(g[0], H.nodes[u]["pos"]) > haversine_m(g[-1], H.nodes[u]["pos"]):
                g = list(reversed(g))
            coords += g
            secs += e["time"] * self.factor(e); free += e["time"]; dist += e["length"]
            used.append(e)
        coords.append(tuple(b_latlon))
        walk = (haversine_m(a_latlon, H.nodes[a]["pos"]) + haversine_m(b_latlon, H.nodes[b]["pos"])) / (30 / 3.6)
        secs += walk; free += walk
        # group consecutive edges by road name -> turn-by-turn
        groups = []
        for e in used:
            if groups and groups[-1]["road"] == e["name"]:
                groups[-1]["dist"] += e["length"]; groups[-1]["edges"].append(e)
            else:
                groups.append({"road": e["name"], "dist": e["length"], "edges": [e]})
        steps, prev_end_bearing, cursor = [], None, 1
        for gi, gr in enumerate(groups):
            seg_coords = []
            for e in gr["edges"]:
                g = e["geom"]
                seg_coords += g
            # orient using route coords
            start = coords[cursor] if cursor < len(coords) else coords[-1]
            n_pts = sum(len(e["geom"]) for e in gr["edges"])
            seg = coords[cursor: cursor + n_pts]
            cursor += n_pts
            if len(seg) < 2:
                continue
            b0, b1 = bearing(seg[0], seg[min(1, len(seg) - 1)]), bearing(seg[-2], seg[-1])
            if prev_end_bearing is None:
                text = f"Head {COMPASS[int((b0 + 22.5) // 45) % 8]} on {gr['road']}"
            else:
                text = f"{turn_word(b0 - prev_end_bearing)} {gr['road']}"
            slow = max(self.factor(e) for e in gr["edges"])
            steps.append({"text": text, "road": gr["road"], "dist": round(gr["dist"]), "slow": round(slow, 1)})
            prev_end_bearing = b1
        steps.append({"text": f"Arrive at {dest_name}", "road": "", "dist": 0, "slow": 1})
        names = [g["road"] for g in groups]
        return {"coords": coords, "eta": max(1, round(secs / 60)), "free_eta": max(1, round(free / 60)),
                "roads": names, "steps": steps, "edges": [e["i"] for e in used], "dist": round(dist)}

    # ---- map data for the dashboard / app
    def geo(self):
        return {"source": self.source,
                "roads": [{"i": e["i"], "name": e["name"], "cls": e["cls"], "g": [[round(p[0], 6), round(p[1], 6)] for p in e["geom"]]} for e in self.edges],
                "areas": {k: [[[round(p[0], 6), round(p[1], 6)] for p in poly] for poly in v] for k, v in self.areas.items()},
                "names": self.road_names}


def short_route(roads, limit=60):
    """'Ellesmere Rd>Markham Rd>...' trimmed for LoRa."""
    abbrev = [r.replace(" Ave", "").replace(" Rd", "").replace(" E", "").replace("Hwy ", "H") for r in roads]
    s = ">".join(abbrev)
    return s if len(s) <= limit else s[: limit - 1] + "…"


# ---------------------------------------------------------------- hospital scoring
def score_hospitals(hospitals, pickup, complaint, triage, age, net, blocked, floods):
    """Rank hospitals for a patient.
    1. Hard filters: open, free beds, required capability, reachable by road.
    2. Score (lower is better) = drive time (x2 if IMMEDIATE) + fullness penalty + preference penalty.
    If nothing passes the capability filter, relax it and flag the result."""
    need = NEEDS.get(complaint, "")
    prefer = "P" if age == "C" else ""
    rows = []
    for h in hospitals:
        r = {"id": h["id"], "name": h["name"], "ok": True, "why": []}
        if not h["open"]:
            r["ok"] = False; r["why"].append("closed")
        if h["free"] <= 0:
            r["ok"] = False; r["why"].append("no beds")
        cap_ok = (not need) or (need in h["caps"])
        if not cap_ok:
            r["why"].append(f"no {need}-capability")
        if triage in (1, 2) and h["id"] == "UFC" and complaint not in ("OT",):
            cap_ok = False; r["why"].append("field clinic: minor only")
        rt = net.route(pickup, (h["lat"], h["lon"]), blocked, floods)
        if not rt:
            r["ok"] = False; r["why"].append("unreachable (roads blocked)")
            r["eta"] = None
        else:
            r["eta"] = rt["eta"]; r["route"] = rt
        r["cap_ok"] = cap_ok
        if r["ok"]:
            fullness = 10 * (1 - h["free"] / max(h["total"], 1))
            pref_pen = 5 if prefer and prefer not in h["caps"] else 0
            w = 2 if triage == 1 else 1
            r["score"] = round(w * r["eta"] + fullness + pref_pen, 1)
            r["breakdown"] = f"{w}x{r['eta']}min + {fullness:.1f} fullness" + (f" + {pref_pen} no-paeds" if pref_pen else "")
        rows.append(r)
    good = sorted([r for r in rows if r["ok"] and r["cap_ok"]], key=lambda r: r["score"])
    relaxed = False
    if not good:
        # nobody has the capability: prefer full hospitals over the minor-injury field clinic
        good = sorted([r for r in rows if r["ok"]], key=lambda r: r["score"] + (50 if any("field clinic" in w for w in r["why"]) else 0))
        relaxed = bool(good)
    best = good[0] if good else None
    return best, sorted(rows, key=lambda r: (not (r["ok"] and r["cap_ok"]), r.get("score") or 999)), relaxed


# ---------------------------------------------------------------- red flags (rule-based, deterministic)
def red_flags(case, profile):
    """Decision support, not diagnosis. Each flag carries its reason."""
    f = []
    c, tri, age = case["complaint"], case["triage"], case["age"]
    extras = case.get("extras", {})
    conds = " ".join(profile.get("conditions", [])).lower() if profile else ""
    meds = " ".join(profile.get("meds", [])).lower() if profile else ""
    allergies = profile.get("allergies", []) if profile else []
    if c == "CP":
        f.append(("Possible cardiac event: rule out first", "chest pain" + (f", age {profile['age']}" if profile else "")))
    if c == "BR":
        f.append(("Airway / breathing compromise", "reported breathing difficulty"))
    if case.get("breathing") == "fast":
        f.append(("Respiratory rate > 30", "START: breathing very fast"))
    if c == "UN" or case.get("responds") is False:
        f.append(("Altered consciousness: protect airway", "does not respond to commands"))
    if "warfarin" in meds or "anticoag" in meds or "BT" in extras.get("CX", ""):
        f.append(("High bleeding risk: on blood thinners", "medication list"))
    if "diabet" in conds or "DM" in extras.get("CX", ""):
        f.append(("Check blood glucose", "known diabetes"))
    if "pregnan" in conds or c == "PR":
        f.append(("Obstetric patient: notify L&D", "pregnancy"))
    if "asthma" in conds:
        f.append(("Asthma history: bronchospasm risk", "known asthma"))
    if "epilep" in conds or "SZ" in extras.get("CX", ""):
        f.append(("Seizure history", "known epilepsy"))
    for a in allergies + ([extras["AL"]] if extras.get("AL") and extras["AL"].lower() not in ("none", "nkda", "unknown") else []):
        f.append((f"ALLERGY: {a}", "medical profile" if a in allergies else "bystander report"))
    if age == "C":
        f.append(("Paediatric patient: weight-based dosing", "age group child"))
    if tri == 1 and not f:
        f.append(("IMMEDIATE by START triage", "triage answers"))
    return [{"flag": a, "why": b, "ack": False} for a, b in f]


def prepare_list(case):
    """What the receiving hospital should get ready."""
    c = case["complaint"]
    base = {"CP": ["ECG", "Cardiac team paged", "Troponin draw"], "BR": ["Oxygen", "Nebuliser", "Airway kit"],
            "BL": ["Trauma bay", "Blood bank notified"], "BU": ["Burn dressings", "IV fluids"],
            "UN": ["Airway kit", "Glucose check", "CT head"], "PR": ["L&D team", "Neonatal warmer"],
            "FX": ["X-ray", "Splints", "Pain control"], "OT": ["General ER assessment"]}.get(c, [])
    return base
