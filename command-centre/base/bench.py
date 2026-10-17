"""Performance benchmark for the dispatch engine (prints real measured timings on this machine).

    python bench.py            # built-in Scarborough grid + a synthetic city-sized grid

The synthetic grid (120 x 120 intersections, ~28,000 road segments) is roughly the size of a real
OpenStreetMap drive network for a 6 km radius, to show the engine stays interactive at city scale.
"""
import copy, random, statistics, time

import networkx as nx

from data import HOSPITALS, EMS_POST
from logic import RoadNet, haversine_m
from engine import Engine


class GridNet:
    """Minimal stand-in with the RoadNet interface the engine needs."""
    def __init__(self, n=120, lat0=43.74, lon0=-79.30, step=0.0009):
        self.G, self.edges = nx.Graph(), []
        self.slow, self.live, self.risk, self.closed_edges = {}, {}, {}, set()
        for i in range(n):
            for j in range(n):
                self.G.add_node((i, j), pos=(lat0 + i * step, lon0 + j * step * 1.4))
        for i in range(n):
            for j in range(n):
                for di, dj in ((1, 0), (0, 1)):
                    if i + di < n and j + dj < n:
                        u, v = (i, j), (i + di, j + dj)
                        L = haversine_m(self.G.nodes[u]["pos"], self.G.nodes[v]["pos"])
                        spd = 60 if (i % 10 == 0 or j % 10 == 0) else 40
                        self.edges.append({"i": len(self.edges), "u": u, "v": v, "name": f"r{i}_{j}", "time": L / (spd / 3.6)})
                        self.G.add_edge(u, v, i=len(self.edges) - 1)

    def factor(self, e):
        return self.slow.get(e["name"], 1.0) * self.live.get(e["i"], 1.0) * (1 + 2 * self.risk.get(e["i"], 0.0))


def facilities(n, lat0, lon0, span):
    rnd = random.Random(3)
    out = []
    for k in range(n):
        clinic = k % 3 == 0
        out.append({"id": f"F{k}", "name": f"Facility {k}", "lat": lat0 + rnd.uniform(0, span), "lon": lon0 + rnd.uniform(0, span * 1.4),
                    "total": 20, "free": rnd.randint(0, 8), "caps": "" if clinic else rnd.choice(["CT", "T", "CTOP", "CB", "C"]),
                    "open": rnd.random() > 0.1, "er_wait": rnd.randint(15, 120), "kind": "clinic" if clinic else "hospital",
                    "er_spaces": rnd.randint(4, 12), "svc_min": rnd.randint(20, 60)})
    return out


def run(label, net, facs, n_cases, batch, lat0, lon0, span):
    e = Engine(net, facs)
    rnd = random.Random(11)
    units = {f"U{k}": (lat0 + rnd.uniform(0, span), lon0 + rnd.uniform(0, span * 1.4)) for k in range(8)}
    cases = [{"id": f"c{i}", "complaint": rnd.choice(["CP", "BL", "BR", "FX", "OT", "UN", "BU"]), "triage": rnd.choice([1, 2, 2, 3, 3]),
              "loc": (lat0 + rnd.uniform(0, span), lon0 + rnd.uniform(0, span * 1.4))} for i in range(n_cases)]
    t0 = time.perf_counter(); e.router.compile(); build = (time.perf_counter() - t0) * 1000
    times = []
    for c in cases:
        t0 = time.perf_counter()
        e.evaluate(c, c["loc"], units=units)
        times.append((time.perf_counter() - t0) * 1000)
    b = e.optimize_batch(cases[:batch], units=units)
    print(f"\n{label}: {len(net.edges):,} road segments, {len(facs)} facilities, {len(units)} ambulances")
    print(f"  graph compile           {build:8.1f} ms (once per road change)")
    print(f"  one patient, all sites  {statistics.median(times):8.1f} ms median, {max(times):.1f} ms worst  ({n_cases} patients)")
    print(f"  joint assignment        {b['compute_ms']:8.1f} ms for {b['patients']} patients x {b['slots']} bed slots")
    print(f"  expected harm vs first-come-first-served: {b['opt_loss']} vs {b['fcfs_loss']}  ({b['saved_pct']}% lower)")


if __name__ == "__main__":
    run("Scarborough demo map", RoadNet(), copy.deepcopy(HOSPITALS), 100, 12, 43.755, -79.30, 0.05)
    g = GridNet()
    run("Synthetic city-scale grid", g, facilities(30, 43.74, -79.30, 0.10), 100, 40, 43.74, -79.30, 0.10)
