"""Citizen road reports: one report slows a road, a second reporter confirms (closes) it."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as S


def _reset():
    S.S.update({"blocked": [], "floods": [], "slow": {}, "road_reports": [], "cases": {}})
    S.NET.slow.clear()


def test_one_report_only_slows():
    _reset()
    S.h_road(["r1", "BLOCK", "43.7766,-79.2300", ""], "n1", "A", 0, None)
    assert S.S["blocked"] == [] and "Ellesmere Rd" in S.S["slow"]


def test_second_person_confirms():
    _reset()
    S.h_road(["r1", "BLOCK", "43.7766,-79.2300", ""], "n1", "A", 0, None)
    S.h_road(["r2", "BLOCK", "43.7767,-79.2290", ""], "n2", "B", 0, None)
    assert S.S["blocked"] == ["Ellesmere Rd"] and "Ellesmere Rd" not in S.S["slow"]


def test_same_person_twice_does_not_confirm():
    _reset()
    S.h_road(["r1", "BLOCK", "43.7766,-79.2300", ""], "n1", "A", 0, None)
    S.h_road(["r2", "BLOCK", "43.7766,-79.2300", ""], "n1", "A", 0, None)
    assert S.S["blocked"] == []


def test_responder_flood_confirms_citizen_flood():
    _reset()
    S.h_road(["r1", "FLOOD", "43.7766,-79.2300", ""], "n1", "A", 0, None)
    assert S.S["floods"] == []
    S.h_flood(["43.7768,-79.2302", "300"], "n9", "RESP", 0, None)
    assert S.S["road_reports"][0]["confirmed"]


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("PASS", k)
    print(f"{n} tests passed")
