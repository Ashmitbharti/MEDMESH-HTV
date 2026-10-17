"""Run: python -m pytest base/tests -q   (or: python base/tests/test_engine.py)"""
import copy, itertools, os, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data import HOSPITALS, PHARMACIES, EMS_POST
from logic import RoadNet
from engine import Engine, plan_supply, DuplicateDetector, AuditLog, BedEstimator
from engine.queueing import erlang_c, fifo_wait, priority_waits, calibrate_lambda
from engine.clinical import profile_for, outcome_loss

NET = RoadNet()
UNITS = {"EMS": (EMS_POST["lat"], EMS_POST["lon"])}
PT = (43.7712, -79.1931)


def eng():
    return Engine(NET, copy.deepcopy(HOSPITALS))


def test_erlang_c_known_value():
    assert abs(erlang_c(2, 1.0) - 1 / 3) < 1e-9          # textbook M/M/2, a = 1
    assert erlang_c(1, 0.5) == 0.5                        # M/M/1: P(wait) = rho


def test_calibration_reproduces_wait():
    lam = calibrate_lambda(8, 1 / 45, 70)
    assert abs(fifo_wait(8, lam, 1 / 45) - 70) < 0.5


def test_priority_order():
    w = priority_waits(8, [0.02, 0.06, 0.09], 1 / 45)
    assert w[0] < w[1] < w[2]


def test_outcome_loss_monotonic():
    p = profile_for("CP", 1)
    assert outcome_loss(p, 10) < outcome_loss(p, 30) < outcome_loss(p, 60) <= p["weight"]


def test_cardiac_goes_to_cardiac_centre():
    rec = eng().evaluate({"id": "t", "complaint": "CP", "triage": 1, "loc": PT}, PT, units=UNITS)
    assert "C" in next(r for r in rec["candidates"] if r["id"] == rec["chosen"])["caps"]


def test_minor_goes_to_clinic():
    rec = eng().evaluate({"id": "t", "complaint": "FX", "triage": 3, "loc": PT}, PT, units=UNITS)
    assert rec["chosen"] == "UFC"


def test_flood_reroutes():
    e = eng()
    a = e.evaluate({"id": "t", "complaint": "CP", "triage": 1, "loc": PT}, PT, units=UNITS)["chosen"]
    h = next(x for x in HOSPITALS if x["id"] == a)
    b = e.evaluate({"id": "t", "complaint": "CP", "triage": 1, "loc": PT}, PT,
                   floods=[{"lat": h["lat"], "lon": h["lon"], "r": 500}], units=UNITS)["chosen"]
    assert b != a


def test_bed_reserved_on_commit():
    e = eng()
    rec = e.evaluate({"id": "t", "complaint": "CP", "triage": 1, "loc": PT}, PT, units=UNITS)
    before = e.beds[rec["chosen"]].state()["mean"]
    e.commit(rec)
    assert e.beds[rec["chosen"]].state()["mean"] <= before - 0.99


def test_kalman_report_dominates():
    b = BedEstimator(20, 6, now=0)
    b.assign(3, now=60)
    b.report(10, now=3600)
    assert abs(b.state(now=3600)["mean"] - 10) < 1.5 and b.state(now=3600)["source"] == "reported"
    early = b.state(now=3601)["sd"]
    assert b.state(now=3600 + 3600)["sd"] > early   # uncertainty grows without reports


def test_batch_never_worse_than_fcfs():
    import random
    random.seed(7)
    cases = [{"id": f"p{i}", "complaint": random.choice(["CP", "BL", "BR", "FX", "OT"]), "triage": random.choice([1, 2, 3]),
              "loc": (43.77 + random.uniform(-.02, .02), -79.21 + random.uniform(-.04, .04))} for i in range(10)]
    out = eng().optimize_batch(cases, units=UNITS)
    assert out["opt_loss"] <= out["fcfs_loss"] + 1e-9


def test_supply_exact_is_optimal():
    order = {"INSULIN": 15, "EPIPEN": 8}
    mins = {"MSP": 6, "ECP": 9, "MVR": 14}
    phs = copy.deepcopy(PHARMACIES)
    for p in phs:
        p["open"] = True
    plan = plan_supply(order, phs, mins)
    def ok(S): return all(sum(next(p for p in phs if p["id"] == x)["stock"].get(i, 0) for x in S) >= q for i, q in order.items())
    brute = min((S for k in range(1, 4) for S in itertools.combinations(mins, k) if ok(S)),
                key=lambda S: sum(mins[x] for x in S) + 10 * len(S))
    assert set(plan["pharmacies"]) == set(brute) and not plan["shortfall"]


def test_dedup_merges_nearby_same_complaint():
    d, t = DuplicateDetector(), time.time()
    d.add("a", PT, "CP", "", t)
    inc, dup, _ = d.add("b", (PT[0] + 0.0005, PT[1]), "CP", "", t + 60)
    assert dup and inc == "a"
    _, dup2, _ = d.add("c", (PT[0] + 0.02, PT[1]), "CP", "", t + 70)
    assert not dup2
    _, dup3, _ = d.add("e", PT, "CP", "AAA111", t + 80)
    _, dup4, _ = d.add("f", PT, "CP", "BBB222", t + 90)
    assert dup3 and not (dup4 and d._find("f") == d._find("e"))


def test_audit_detects_tampering():
    path = tempfile.mktemp(suffix=".jsonl")
    log = AuditLog(path)
    for i in range(5):
        log.append("dispatch", {"case": i, "chosen": "CEN"})
    assert log.verify()["ok"]
    lines = open(path).read().splitlines()
    lines[2] = lines[2].replace("CEN", "SGH")
    open(path, "w").write("\n".join(lines) + "\n")
    assert not AuditLog(path).verify()["ok"]


def test_profile_pregnancy_requires_obstetrics():
    from data import PROFILES
    rec = eng().evaluate({"id": "t", "complaint": "BL", "triage": 2, "loc": PT, "patient": PROFILES["QL7T2D"]}, PT, units=UNITS)
    assert "O" in rec["profile"]["need"]
    assert "O" in next(r for r in rec["candidates"] if r["id"] == rec["chosen"])["caps"]


def test_profile_blood_thinner_raises_urgency():
    from data import PROFILES
    base = eng().evaluate({"id": "t", "complaint": "FX", "triage": 2, "loc": PT}, PT, units=UNITS)["profile"]
    warf = eng().evaluate({"id": "t", "complaint": "FX", "triage": 2, "loc": PT, "patient": PROFILES["MX4K9P"]}, PT, units=UNITS)["profile"]
    assert warf["tau"] < base["tau"] and warf["weight"] > base["weight"]


if __name__ == "__main__":
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for f in fns:
        f()
        print("PASS", f.__name__)
    print(f"{len(fns)} tests passed")
