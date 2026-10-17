"""Dispatch optimiser: choose the destination (and ambulance) that minimises expected harm.

For one patient, every facility is scored on TIME TO TREATMENT, not distance:

    T = ambulance -> patient  (road time, best available unit)
      + on-scene time
      + patient -> facility   (road time; floods, closures, congestion and flood-risk included)
      + expected ED wait for THIS patient's priority class   (queueing model, queueing.py)
      + P(no bed on arrival) * redirect time                (bed nowcast uncertainty, estimator.py)

    cost = outcome_loss(T)            weight * (1 - exp(-T / tau))  (clinical.py)
         + small preference penalties (e.g. child -> paediatric centre)

Hard filters remove facilities that are closed / diverting, unreachable, lack the required capability
(relaxed only if NO facility has it), clinics for non-minor patients, or have no bed for patients who need one.

For several patients at once (mass casualty), `optimize_batch` solves the joint assignment as a linear
assignment problem (Hungarian algorithm) over expanded bed slots, where each extra patient sent to the same
hospital sees a longer predicted queue. It reports how much expected harm it saves against first-come-first-served.
"""
import math
import time
from collections import defaultdict, deque

import numpy as np
from scipy.optimize import linear_sum_assignment

from .clinical import profile_for, outcome_loss
from .patient import patient_modifiers
from .estimator import BedEstimator
from .queueing import ERQueue
from .routing import Router

HOME_BONUS = 0.03         # fraction of weight credited to the patient's usual hospital (records, specialists)
REDIRECT_MIN = 25.0       # extra minutes if the patient arrives and there is no bed (assumption)
PAEDS_PENALTY = 0.05      # fraction of weight per missing preferred capability (e.g. child -> no paediatrics)
ARRIVAL_WINDOW_S = 3600   # live arrival rates are measured over the last hour
INFEASIBLE = 1e6


def _phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


class Engine:
    def __init__(self, net, facilities):
        self.router = Router(net)
        self.fac = {}
        self.queues = {}
        self.beds = {}
        self.dispatches = defaultdict(deque)   # facility id -> deque[(ts, class)]
        self.decisions = {}
        self.stats = {"decisions": 0, "batch_runs": 0, "total_ms": 0.0}
        self.sync(facilities)

    # ------------------------------------------------------------------ facility state
    def sync(self, facilities):
        """Register facilities (dicts from data.py / live state). Keeps learned state for known ones."""
        for f in facilities:
            fid = f["id"]
            self.fac[fid] = f
            if fid not in self.queues:
                self.queues[fid] = ERQueue(f.get("er_spaces", max(2, f.get("total", 10) // 3)),
                                           f.get("svc_min", 45), f.get("er_wait", 60))
            if fid not in self.beds:
                self.beds[fid] = BedEstimator(f.get("total", 10), f.get("free", 0),
                                              walkin_per_hr=f.get("walkin_admit_hr", 1.0),
                                              discharge_per_hr=f.get("discharge_hr", 0.8))

    def report(self, fid, free=None, wait=None, now=None):
        """A hospital reported over the mesh (C| message) or from the dashboard."""
        if fid not in self.fac:
            return
        if free is not None:
            self.beds[fid].report(free, now)
        if wait is not None:
            self.queues[fid].recalibrate(wait)

    def _live_rates(self, now):
        for fid, dq in self.dispatches.items():
            while dq and now - dq[0][0] > ARRIVAL_WINDOW_S:
                dq.popleft()
            ex = [0.0, 0.0, 0.0]
            for _, k in dq:
                ex[k] += 1.0 / 60.0   # per minute over the window
            self.queues[fid].extra = ex

    # ------------------------------------------------------------------ one patient
    def _pickup(self, patient_loc, units, blocked, floods):
        if not units:
            return None, 0.0
        times = self.router.matrix(units, {"pt": patient_loc}, blocked, floods)
        best = min(((u, t) for (u, _), t in times.items() if t is not None), key=lambda x: x[1], default=(None, None))
        return best[0], (best[1] or 0) / 60.0

    def evaluate(self, case, start, blocked=(), floods=(), units=None, onboard=False, now=None):
        """Score every facility for one patient. Returns a decision record (nothing is committed)."""
        t0 = time.perf_counter()
        now = now if now is not None else time.time()
        self._live_rates(now)
        prof = profile_for(case["complaint"], case["triage"], case.get("age", "A"))
        mods = patient_modifiers(case.get("patient"), case["complaint"], case["triage"])
        if isinstance(mods["age"], (int, float)) and mods["age"] < 18 and "P" not in prof["prefer"]:
            prof["prefer"] += "P"
        prof["need"] = "".join(dict.fromkeys(prof["need"] + mods["need"]))
        prof["prefer"] = "".join(c for c in dict.fromkeys(prof["prefer"] + mods["prefer"]) if c not in prof["need"])
        prof["tau"] *= mods["tau_x"]
        prof["weight"] *= mods["weight_x"]
        prof["home"] = mods["home"]
        prof["from_profile"] = mods["reasons"]
        unit, pickup_min = (None, 0.0) if onboard else self._pickup(case["loc"], units or {}, blocked, floods)
        scene = 0.0 if onboard else prof["scene_min"]
        targets = {fid: (f["lat"], f["lon"]) for fid, f in self.fac.items()}
        drive = self.router.times_from(start, targets, blocked, floods)

        rows = []
        for fid, f in self.fac.items():
            kind = f.get("kind", "hospital")
            r = {"id": fid, "name": f["name"], "kind": kind, "why_out": [], "cap_ok": True}
            if not f.get("open", True):
                r["why_out"].append("closed / diverting")
            if kind == "clinic" and not prof["clinic_ok"]:
                r["why_out"].append("clinic: minor injuries only")
            if prof["need"] and prof["need"] not in f.get("caps", ""):
                r["cap_ok"] = False
            d = drive.get(fid)
            if d is None:
                r["why_out"].append("unreachable (roads blocked / flooded)")
            bed = self.beds[fid].state(now)
            p_full = 0.0
            if prof["needs_bed"] and kind != "clinic":
                p_full = 1.0 - _phi((bed["mean"] - 0.5) / max(bed["sd"], 0.05))
                if bed["mean"] < 0.5 and bed["sd"] < 0.5:
                    r["why_out"].append("no beds")
            wait = self.queues[fid].wait(prof["klass"])
            r.update({"drive_min": None if d is None else round(d / 60.0, 1), "wait_min": round(wait, 1),
                      "beds": bed["mean"], "beds_sd": bed["sd"], "beds_source": bed["source"], "beds_age_min": bed["age_min"],
                      "p_no_bed": round(p_full, 3), "caps": f.get("caps", "")})
            if d is not None:
                T = pickup_min + scene + d / 60.0 + wait + p_full * REDIRECT_MIN
                loss = outcome_loss(prof, T)
                missing = [c for c in prof["prefer"] if c not in f.get("caps", "")]
                pen = PAEDS_PENALTY * prof["weight"] * len(missing)
                if prof.get("home") and fid == prof["home"]:
                    pen -= HOME_BONUS * prof["weight"]
                r.update({"time_to_treatment": round(T, 1), "outcome_loss": round(loss, 4), "penalty": round(pen, 4),
                          "cost": round(loss + pen + 0.0005 * T, 5)})
            rows.append(r)

        feasible = [r for r in rows if not r["why_out"] and "cost" in r]
        good = sorted([r for r in feasible if r["cap_ok"]], key=lambda r: r["cost"])
        relaxed = False
        if not good and feasible:
            relaxed = True
            good = sorted(feasible, key=lambda r: r["cost"])
        for r in rows:
            if not r["cap_ok"] and not relaxed:
                r["why_out"].append(f"no {prof['need']}-capability")
            r["eligible"] = not r["why_out"]
        chosen = good[0] if good else None
        runner = good[1] if len(good) > 1 else None
        ms = (time.perf_counter() - t0) * 1000
        rec = {
            "case": case["id"], "ts": now, "profile": prof, "unit": unit, "pickup_min": round(pickup_min, 1),
            "scene_min": scene, "onboard": onboard, "relaxed": relaxed,
            "chosen": chosen["id"] if chosen else None, "runner_up": runner["id"] if runner else None,
            "candidates": sorted(rows, key=lambda r: (not r["eligible"], r.get("cost", INFEASIBLE))),
            "evaluated": len(rows), "eliminated": sum(1 for r in rows if not r["eligible"]),
            "compute_ms": round(ms, 2), "router": dict(self.router.stats),
            "removed_edges": getattr(self.router, "removed", {}),
        }
        rec["explain"] = self._explain(rec, chosen, runner, prof)
        self.stats["decisions"] += 1
        self.stats["total_ms"] += ms
        return rec

    def _explain(self, rec, c, r, prof):
        if not c:
            return ["No facility can be reached right now: case held, will re-plan when roads or capacity change."]
        out = [f"{c['name']}: treatment expected in {c['time_to_treatment']:.0f} min "
               f"({c['drive_min']:.0f} min drive, {c['wait_min']:.0f} min expected wait at triage level {prof['triage']}, "
               f"{prof['triage_name'].lower()})."]
        if prof["need"]:
            out.append(f"Needs {dict(C='cardiac', T='trauma', B='burns', O='obstetric').get(prof['need'], prof['need'])} care"
                       + (": none reachable, sent to the best general option and flagged." if rec["relaxed"] else "."))
        if r:
            dt = r["time_to_treatment"] - c["time_to_treatment"]
            closer = r["drive_min"] is not None and c["drive_min"] is not None and r["drive_min"] < c["drive_min"]
            if dt < 0:
                why = []
                if prof.get("home") == c["id"]:
                    why.append("it is the patient's usual hospital")
                extra = [x for x in prof["prefer"] if x in c.get("caps", "") and x not in r.get("caps", "")]
                names = dict(C="cardiac", T="trauma", B="burns", O="obstetric", P="paediatric", D="dialysis")
                if extra:
                    why.append("it has " + ", ".join(names.get(x, x) for x in extra) + " care that " + r["name"] + " lacks")
                out.append(f"{r['name']} would start treatment {-dt:.0f} min sooner, but {c['name']} is preferred because "
                           + (" and ".join(why) or "its overall expected outcome is better") + ".")
            elif closer:
                out.append(f"{r['name']} is closer by {c['drive_min'] - r['drive_min']:.0f} min, but its wait is "
                           f"{r['wait_min']:.0f} min, so treatment would start {dt:.0f} min later.")
            else:
                out.append(f"Next best: {r['name']}, {dt:.0f} min slower to treatment.")
        if c["beds_source"] == "estimated":
            out.append(f"Beds at {c['name']} are estimated ({c['beds']:.0f} +/- {c['beds_sd']:.1f}); "
                       f"last report {c['beds_age_min']:.0f} min ago.")
        for reason in prof.get("from_profile", []):
            out.append("MedMesh profile: " + reason + ".")
        out.append(f"Evaluated {rec['evaluated']} facilities, {rec['eliminated']} eliminated, in {rec['compute_ms']:.0f} ms.")
        return out

    def commit(self, rec, now=None):
        """Apply a decision: reserve the bed and count the arrival in the destination's queue."""
        now = now if now is not None else time.time()
        fid = rec["chosen"]
        if not fid:
            return
        self.decisions[rec["case"]] = rec
        if rec["profile"]["needs_bed"] and self.fac[fid].get("kind", "hospital") != "clinic":
            self.beds[fid].assign(1, now)
        self.dispatches[fid].append((now, rec["profile"]["klass"]))

    def release(self, case_id, now=None):
        """Undo a commitment (patient rerouted elsewhere)."""
        rec = self.decisions.pop(case_id, None)
        if not rec or not rec["chosen"]:
            return
        fid = rec["chosen"]
        if rec["profile"]["needs_bed"] and self.fac[fid].get("kind", "hospital") != "clinic":
            self.beds[fid].release(1, now)
        dq = self.dispatches[fid]
        for i, (ts, k) in enumerate(dq):
            if ts == rec["ts"] and k == rec["profile"]["klass"]:
                del dq[i]
                break

    # ------------------------------------------------------------------ many patients at once
    def optimize_batch(self, cases, blocked=(), floods=(), units=None, now=None):
        """Jointly assign pending patients to facilities (mass-casualty mode).

        Columns are bed slots: slot j at facility h means "the j-th patient we send to h now"; its cost uses the
        queue wait with j extra arrivals, so piling everyone onto the nearest hospital is penalised.
        Returns the optimal plan and the first-come-first-served plan for comparison."""
        t0 = time.perf_counter()
        now = now if now is not None else time.time()
        recs = [self.evaluate(c, c["loc"], blocked, floods, units, now=now) for c in cases]
        slots = []
        for fid in self.fac:
            st = self.beds[fid].state(now)
            n = len(cases) if self.fac[fid].get("kind") == "clinic" else int(math.floor(st["effective"] + 0.5))
            for j in range(min(n, len(cases))):
                slots.append((fid, j))
        if not slots or not cases:
            return {"assignments": {}, "fcfs": {}, "saved": 0.0}
        C = np.full((len(cases), len(slots)), INFEASIBLE)
        for i, rec in enumerate(recs):
            prof = rec["profile"]
            by = {r["id"]: r for r in rec["candidates"]}
            for s, (fid, j) in enumerate(slots):
                r = by.get(fid)
                if not r or not r["eligible"] or "time_to_treatment" not in r:
                    continue
                if prof["need"] and not r["cap_ok"] and not rec["relaxed"]:
                    continue
                extra_wait = self.queues[fid].wait(prof["klass"], add_rate=j / 60.0) - r["wait_min"]
                C[i, s] = outcome_loss(prof, r["time_to_treatment"] + max(0.0, extra_wait)) + r["penalty"]
        rows, cols = linear_sum_assignment(C)
        plan = {}
        for i, s in zip(rows, cols):
            if C[i, s] < INFEASIBLE:
                plan[cases[i]["id"]] = {"facility": slots[s][0], "slot": slots[s][1], "loss": round(float(C[i, s]), 4)}
        # baseline: first-come-first-served, each patient takes its own best, filling beds greedily
        used, fcfs = defaultdict(int), {}
        for i, rec in enumerate(recs):
            best = None
            for s, (fid, j) in enumerate(slots):
                if j == used[fid] and C[i, s] < INFEASIBLE and (best is None or C[i, s] < C[i, best]):
                    best = s
            if best is not None:
                fid = slots[best][0]
                used[fid] += 1
                fcfs[cases[i]["id"]] = {"facility": fid, "loss": round(float(C[i, best]), 4)}
        opt_loss = sum(p["loss"] for p in plan.values())
        fcfs_loss = sum(p["loss"] for p in fcfs.values())
        ms = (time.perf_counter() - t0) * 1000
        self.stats["batch_runs"] += 1
        return {"assignments": plan, "fcfs": fcfs, "opt_loss": round(opt_loss, 3), "fcfs_loss": round(fcfs_loss, 3),
                "saved_pct": round(100 * (fcfs_loss - opt_loss) / fcfs_loss, 1) if fcfs_loss > 0 else 0.0,
                "patients": len(cases), "slots": len(slots), "compute_ms": round(ms, 1)}

    def snapshot(self, now=None):
        now = now if now is not None else time.time()
        self._live_rates(now)
        return {fid: {"name": f["name"], "kind": f.get("kind", "hospital"), "queue": self.queues[fid].snapshot(),
                      "beds": self.beds[fid].state(now)} for fid, f in self.fac.items()}
