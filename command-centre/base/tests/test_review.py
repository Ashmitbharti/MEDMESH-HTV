"""After-action review: metrics from records, findings must cite real evidence (Gemini mocked)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine import review

S = {"cases": {
        "a1": {"id": "a1", "status": "delivered", "triage": 1, "complaint": "UN", "hospital": "CEN", "ts": 100, "t_dispatch": 101.5, "pickup_eta": 5,
               "profile": {"name": "X"}, "decision": {"chosen": "CEN", "explain": ["shorter wait"], "candidates": [
                   {"id": "SGH", "eligible": True, "drive_min": 4, "time_to_treatment": 40},
                   {"id": "CEN", "eligible": True, "drive_min": 7, "time_to_treatment": 20}]}},
        "a2": {"id": "a2", "status": "merged", "triage": 1, "complaint": "UN"}},
     "hospitals": [{"id": "CEN", "name": "Centenary", "total": 20, "free": 2}, {"id": "SGH", "name": "SGH", "total": 24, "free": 10}],
     "blocked": ["Ellesmere Rd"], "floods": [], "slow": {}, "road_reports": [], "requests": {"r": {"item": "O2", "status": "unavailable", "verified": True}},
     "notifications": [{"status": "queued"}], "incidents": {}, "checkins": []}
MSG = [(1, "in", "FIELD", "R|a1|...", 2), (2, "out", "ALL", "H|a1|AMB", None), (3, "drop", "FIELD", "x", None)]


def test_metrics():
    m = review.compute(S, MSG)
    assert m["cases"]["total"] == 1 and m["cases"]["duplicates_merged"] == 1
    assert m["cases"]["decision_seconds_median"] == 1.5
    assert m["diversions"][0]["extra_drive_min"] == 3 and m["diversions"][0]["nearest"] == "SGH"
    assert m["hospitals"]["CEN"]["load_pct"] == 90 and m["mesh"]["undelivered"] == 1
    assert "name" not in json.dumps(m["cases"]["rows"])     # de-identified


def test_rules_without_key():
    os.environ.pop("GEMINI_API_KEY", None)
    out = review.findings(review.compute(S, MSG))
    assert out["source"] == "rules" and any("Centenary" in f["title"] for f in out["findings"])


def test_gemini_findings_must_cite_real_evidence():
    os.environ["GEMINI_API_KEY"] = "test"
    orig = review.gemini_findings
    review.gemini_findings = lambda m, k, mo: {"headline": "h", "next_drill": "d", "findings": [
        {"title": "real", "detail": "d", "recommendation": "r", "evidence": ["hospital:CEN", "made:up"]},
        {"title": "invented", "detail": "d", "recommendation": "r", "evidence": ["case:zzzz"]}]}
    try:
        out = review.findings(review.compute(S, MSG))
    finally:
        review.gemini_findings = orig
        os.environ.pop("GEMINI_API_KEY", None)
    assert out["source"] == "gemini" and [f["title"] for f in out["findings"]] == ["real"]
    assert out["findings"][0]["evidence"] == ["hospital:CEN"] and out["dropped"] == 1


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("PASS", k)
    print(f"{n} tests passed")
