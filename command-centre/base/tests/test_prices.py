"""Emergency supply: offers above the price cap are skipped and flagged unless the hospital explicitly allows them."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy
import server as S
from data import PHARMACIES


def _reset():
    S.S.update({"pharmacies": copy.deepcopy(PHARMACIES), "supplies": {}, "price_flags": []})


def test_cap_is_normal_plus_ten_percent():
    pc = S.price_check("INSULIN")
    assert pc["base"] == 40.0 and pc["cap"] == 44.0
    assert {o["pharm"]: o["within"] for o in pc["offers"]}["ECP"] is False


def test_over_cap_seller_skipped_and_flagged():
    _reset()
    S.h_supply(["s1", "CEN", "INSULIN", "20"], "n", "H", 0, None)
    sup = S.S["supplies"]["s1"]
    assert "ECP" not in dict(sup["alloc"]) and "ECP" in sup["flagged"]
    assert S.S["price_flags"][-1]["pct"] == 60.0
    assert all(p <= 44.0 for p in sup["prices"].values())


def test_hospital_can_knowingly_allow():
    _reset()
    S.h_supply(["s2", "CEN", "EPIPEN", "14"], "n", "H", 0, None)
    short_without = S.S["supplies"]["s2"]["short"]
    _reset()
    S.h_supply(["s3", "CEN", "EPIPEN", "14", "ALLOW"], "n", "H", 0, None)
    assert S.S["supplies"]["s3"]["short"] < short_without and S.S["supplies"]["s3"]["flagged"] == []


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("PASS", k)
    print(f"{n} tests passed")
