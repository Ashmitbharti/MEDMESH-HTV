"""Road routing for the dispatch engine.

The road network (OpenStreetMap via prepare_map.py, or the built-in Scarborough grid) is compiled into a
sparse adjacency matrix once per network change. A single Dijkstra run from a patient then gives the travel
time to EVERY facility at once (one-to-all), so ranking 50 hospitals costs one search, not 50.

Edge cost (seconds) = free-flow time
                      x congestion factor   (road reports + learned ambulance speeds, from RoadNet)
                      x (1 + 2 * p_flood)   (flood-risk forecast, soft penalty; see RoadNet.factor)
Edges are removed outright when the road is reported blocked, lies inside a reported flood zone,
or has p_flood >= HARD_RISK.
"""
import math
import time

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

HARD_RISK = 0.85       # above this forecast probability the road is treated as closed
SNAP_SPEED_MS = 30 / 3.6  # off-network access (driveway / walk to the road) at 30 km/h


def _xy(lat, lon, lat0):
    """Equirectangular projection to metres (accurate to <0.1% over a city)."""
    k = 111_320.0
    return (lon * k * math.cos(math.radians(lat0)), lat * k)


class Router:
    def __init__(self, net):
        self.net = net
        self.nodes = list(net.G.nodes)
        self.index = {n: i for i, n in enumerate(self.nodes)}
        pos = np.array([net.G.nodes[n]["pos"] for n in self.nodes])
        self.lat0 = float(pos[:, 0].mean()) if len(pos) else 43.78
        self.xy = np.array([_xy(a, b, self.lat0) for a, b in pos]) if len(pos) else np.zeros((0, 2))
        self.tree = cKDTree(self.xy) if len(pos) else None
        self._key = None
        self._mat = None
        self.stats = {"builds": 0, "searches": 0, "last_build_ms": 0.0, "last_search_ms": 0.0}

    # ------------------------------------------------------------------ graph compilation
    def set_risk(self, risk_by_edge):
        """risk_by_edge: {edge_index: probability}. Shared with RoadNet so turn-by-turn routes agree."""
        risk = {int(k): float(v) for k, v in risk_by_edge.items() if v and v > 0}
        self.net.risk = {k: v for k, v in risk.items() if v < HARD_RISK}
        self.net.closed_edges = {k for k, v in risk.items() if v >= HARD_RISK}
        self._key = None

    def _closed_nodes(self, floods):
        out = set()
        if not floods or self.tree is None:
            return out
        for fz in floods:
            c = _xy(fz["lat"], fz["lon"], self.lat0)
            out.update(self.tree.query_ball_point(c, float(fz["r"])))
        return out

    def compile(self, blocked=(), floods=()):
        key = (tuple(sorted(blocked)), tuple((f["lat"], f["lon"], f["r"]) for f in floods),
               tuple(sorted(self.net.slow.items())), len(self.net.live), hash(frozenset(self.net.live.items())),
               hash(frozenset(self.net.risk.items())), hash(frozenset(self.net.closed_edges)))
        if key == self._key:
            return self._mat
        t0 = time.perf_counter()
        closed = self._closed_nodes(floods)
        rows, cols, w = [], [], []
        self.removed = {"blocked": 0, "flooded": 0, "high_risk": 0}
        for e in self.net.edges:
            if e["name"] in blocked:
                self.removed["blocked"] += 1
                continue
            iu, iv = self.index.get(e["u"]), self.index.get(e["v"])
            if iu is None or iv is None:
                continue
            if iu in closed or iv in closed:
                self.removed["flooded"] += 1
                continue
            if e["i"] in self.net.closed_edges:
                self.removed["high_risk"] += 1
                continue
            cost = e["time"] * self.net.factor(e)
            rows += [iu, iv]; cols += [iv, iu]; w += [cost, cost]
        n = len(self.nodes)
        self._mat = csr_matrix((w, (rows, cols)), shape=(n, n))
        self._key = key
        self.stats["builds"] += 1
        self.stats["last_build_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        self.stats["edges"] = len(self.net.edges)
        return self._mat

    # ------------------------------------------------------------------ queries
    def snap(self, latlon):
        """Nearest road node and the access time (s) to reach it."""
        d, i = self.tree.query(_xy(latlon[0], latlon[1], self.lat0))
        return int(i), d / SNAP_SPEED_MS

    def times_from(self, origin, targets, blocked=(), floods=()):
        """One Dijkstra run from `origin` (lat, lon). targets: {key: (lat, lon)}.
        Returns {key: seconds or None if unreachable}."""
        mat = self.compile(blocked, floods)
        t0 = time.perf_counter()
        src, access = self.snap(origin)
        dist = dijkstra(mat, directed=False, indices=src)
        out = {}
        for k, ll in targets.items():
            j, acc2 = self.snap(ll)
            d = dist[j]
            out[k] = None if not np.isfinite(d) else float(d + access + acc2)
        self.stats["searches"] += 1
        self.stats["last_search_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return out

    def matrix(self, origins, targets, blocked=(), floods=()):
        """Many-to-many travel times. origins/targets: {key: (lat, lon)}. One Dijkstra per origin row,
        all rows in a single vectorised call."""
        mat = self.compile(blocked, floods)
        okeys, tkeys = list(origins), list(targets)
        if not okeys or not tkeys:
            return {}
        osnap = [self.snap(origins[k]) for k in okeys]
        tsnap = [self.snap(targets[k]) for k in tkeys]
        dist = dijkstra(mat, directed=False, indices=[s for s, _ in osnap])
        dist = np.atleast_2d(dist)
        out = {}
        for a, (ok, (_, acc)) in enumerate(zip(okeys, osnap)):
            for b, (tk, (j, acc2)) in enumerate(zip(tkeys, tsnap)):
                d = dist[a, j]
                out[(ok, tk)] = None if not np.isfinite(d) else float(d + acc + acc2)
        self.stats["searches"] += len(okeys)
        return out
