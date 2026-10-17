"""Pharmacy device: stock/price updates, answering requests, quick replies to hospitals, anonymous nearby demand."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy
import server as S
from data import HOSPITALS, PHARMACIES

SENT = []


def _reset():
    SENT.clear()
    S.send = lambda text, dest=None, kind="": SENT.append((text, dest))
    S.S.update({"hospitals": copy.deepcopy(HOSPITALS), "pharmacies": copy.deepcopy(PHARMACIES), "requests": {}, "supplies": {},
                "roles": {}, "price_flags": []})
    S.h_join(["X", "MSP", "Morningside"], "PHARM_MSP", "PHARM_MSP", 0, None)
    S.h_join(["H", "CEN", "Centenary"], "HOSP_CEN", "HOSP_CEN", 0, None)


def test_stock_and_price_update_keeps_other_prices():
    _reset()
    S.h_pharm(["MSP", "1", "INSULIN:3@42,O2:2@61"], "PHARM_MSP", "PHARM_MSP", 0, None)
    p = S.pharm("MSP")
    assert p["stock"]["INSULIN"] == 3 and p["stock"]["O2"] == 2
    assert S.price_of(p, "INSULIN") == 42 and S.price_of(p, "EPIPEN") == 125.0   # untouched items keep their price
    assert ("A|P|OK", "PHARM_MSP") in SENT


def test_request_reaches_pharmacy_with_distance_and_demand():
    _reset()
    S.h_med(["m1", "INSULIN", "N", "1", "43.7880,-79.2040", "MX4K9P"], "FIELD", "FIELD", 0, None)
    mr = next(t for t, d in SENT if t.startswith("MR|m1|"))
    f = mr.split("|")
    assert "MSP" in f[6].split(",") and len(f[7].split(",")) == len(f[6].split(",")) and f[8] in ("0", "1")
    assert "MX4K9P" not in mr                                                # the MedMesh ID never goes to pharmacies
    nd = next(t for t, d in SENT if d == "PHARM_MSP" and t.startswith("ND|MSP|"))
    assert "INSULIN:1/0" in nd and "MX4K9P" not in nd                       # counts only, no IDs


def test_over_cap_place_asked_only_when_no_fair_one():
    _reset()
    S.h_pharm(["MSP", "1", "INSULIN:5@70"], "PHARM_MSP", "PHARM_MSP", 0, None)   # MSP now over the $44 cap
    S.pharm("MVR")["open"] = True                                           # MVR and FBP sell within the cap
    assert set(p["id"] for p in S.pick_pharmacies("INSULIN", (43.79, -79.205))) == {"MVR", "FBP"}
    S.pharm("MVR")["open"] = False
    S.pharm("FBP")["open"] = False                                          # no fair place left: over-cap ones are still asked
    assert set(p["id"] for p in S.pick_pharmacies("INSULIN", (43.79, -79.205))) == {"MSP", "ECP"}


def test_pharmacy_reply_reaches_hospital():
    _reset()
    S.h_supply(["s9", "CEN", "DRESS", "5"], "HOSP_CEN", "HOSP_CEN", 0, None)
    pid = S.S["supplies"]["s9"]["alloc"][0][0]
    S.h_join(["X", pid, pid], f"PHARM_{pid}", f"PHARM_{pid}", 0, None)
    S.h_pharm_reply(["s9", "RUNNER"], f"PHARM_{pid}", f"PHARM_{pid}", 0, None)
    assert (f"SU|s9|{pid}|RUNNER", "HOSP_CEN") in SENT


def test_held_item_out_reroutes_request():
    _reset()
    S.h_med(["m2", "INHALER", "D", "1", "43.7880,-79.2040", ""], "FIELD", "FIELD", 0, None)
    r = S.S["requests"]["m2"]
    for pid in list(r["asked"]):
        S.pharmacy_answer(r, pid == "MSP", 15, pid)
    assert r["pharmacy"] == "MSP"
    S.h_pharm_reply(["m2", "OUT"], "PHARM_MSP", "PHARM_MSP", 0, None)
    assert r["pharmacy"] is None and "MSP" in r["tried"] and S.pharm("MSP")["stock"]["INHALER"] == 0


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1
    print(f"{n} passed")
