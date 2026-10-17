"""Duplicate SOS detection: several bystanders often report the same emergency.

Two reports are linked when they are close in space AND time AND compatible in content:
    distance <= RADIUS_M, |dt| <= WINDOW_S, same complaint (or one is "OT"),
    and, if both carry a MedMesh ID, the IDs match (different IDs are never merged).
Linked reports form clusters (connected components, union-find), DBSCAN-style with min_samples = 1.
Each cluster becomes ONE incident, so one patient never gets two ambulances.
App retries (same report id) are handled before this, in the message layer.
"""
import math
import time

RADIUS_M = 150.0
WINDOW_S = 900.0


def _hav(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class DuplicateDetector:
    def __init__(self):
        self.reports = []   # dicts: id, loc, ts, complaint, mid
        self.parent = {}

    def _find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def _union(self, a, b):
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            # keep the earliest report as the incident id
            ta = next(r["ts"] for r in self.reports if r["id"] == ra)
            tb = next(r["ts"] for r in self.reports if r["id"] == rb)
            if tb < ta:
                ra, rb = rb, ra
            self.parent[rb] = ra

    @staticmethod
    def compatible(a, b):
        if a["mid"] and b["mid"] and a["mid"] != b["mid"]:
            return False
        if a["complaint"] != b["complaint"] and "OT" not in (a["complaint"], b["complaint"]):
            return False
        return abs(a["ts"] - b["ts"]) <= WINDOW_S and _hav(a["loc"], b["loc"]) <= RADIUS_M

    def add(self, rid, loc, complaint, mid="", ts=None):
        """Register a report. Returns (incident_id, is_duplicate, matched_report_ids)."""
        r = {"id": rid, "loc": tuple(loc), "complaint": complaint, "mid": (mid or "").upper(), "ts": ts or time.time()}
        self.reports = [x for x in self.reports if r["ts"] - x["ts"] <= 4 * WINDOW_S]
        self.parent = {k: v for k, v in self.parent.items() if any(x["id"] == k for x in self.reports)}
        for k in list(self.parent):
            if self.parent[k] not in self.parent:
                self.parent[k] = k
        self.reports.append(r)
        self.parent[rid] = rid
        matched = []
        for x in self.reports[:-1]:
            if not self.compatible(r, x):
                continue
            # never merge two different MedMesh IDs, even indirectly through an anonymous report
            root = self._find(x["id"])
            ids = {y["mid"] for y in self.reports[:-1] if y["mid"] and self._find(y["id"]) == root}
            mine = {y["mid"] for y in self.reports if y["mid"] and self._find(y["id"]) == self._find(rid)}
            if len(ids | mine) > 1:
                continue
            matched.append(x["id"])
            self._union(x["id"], rid)
        root = self._find(rid)
        return root, root != rid, matched
