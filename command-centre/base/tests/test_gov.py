"""Government view: de-identified overview, opt-in watchlist with silent people, wellness checks, mitigation deck."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy, json
import server as S
from data import HOSPITALS, PHARMACIES
from engine import gov

SENT = []


def _reset():
    SENT.clear()
    S.send = lambda text, dest=None, kind="": SENT.append((text, dest))
    S.S.update({"hospitals": copy.deepcopy(HOSPITALS), "pharmacies": copy.deepcopy(PHARMACIES), "cases": {}, "requests": {}, "supplies": {},
                "roles": {}, "checkins": []})


def test_overview_has_no_names_or_ids():
    _reset()
    S.h_report(["g1", "1", "CP", "A", "1", "0F11", "43.8070,-79.2220", "MX4K9P", ""], "FIELD", "FIELD", 0, ["FIELD", "BASE"])
    ov = gov.overview(S.S, [{"id": "FIELD", "online": True, "lat": 43.768, "lon": -79.19}])
    txt = json.dumps(ov)
    assert "MX4K9P" not in txt and "Arun" not in txt
    assert next(a for a in ov["areas"] if a["id"] == "MLV")["cases"]["1"] == 1


def test_opt_in_person_goes_silent_then_checks_in():
    _reset()
    profiles = {"ABC123": {"name": "Test Person", "devices": ["Home oxygen"], "watch": True, "home": [43.807, -79.222]},
                "NOPE11": {"name": "Not opted in", "devices": ["Home oxygen"], "watch": False, "home": [43.807, -79.222]}}
    nodes = [{"id": "BASE", "online": True, "lat": 43.785, "lon": -79.262}]
    started = time.time() - 4 * 3600
    wl = gov.watchlist(S.S, profiles, [], nodes, started)
    assert wl["people"] == 1 and wl["silent"][0]["token"] == gov.token_of("ABC123")
    assert "Test Person" not in json.dumps(wl) and "ABC123" not in json.dumps(wl)
    S.h_checkin(["k1", "SAFE", "Test", "43.8070,-79.2220", "ABC123"], "FIELD", "FIELD", 0, None)
    wl = gov.watchlist(S.S, profiles, [], nodes, started)
    assert wl["silent"] == []


def test_mitigation_rules_cite_real_areas():
    _reset()
    nodes = [{"id": "BASE", "online": True, "lat": 43.785, "lon": -79.262}]
    wl = gov.watchlist(S.S, {}, gov.seed_registry(), nodes, time.time())
    ov = gov.overview(S.S, nodes)
    os.environ.pop("GEMINI_API_KEY", None)
    deck = gov.mitigation(wl, ov)
    _, keys = gov.facts(wl, ov)
    assert deck["source"] == "rules" and deck["slides"]
    assert all(e in keys for s in deck["slides"] for a in s["actions"] for e in a["evidence"])


def test_wellness_check_goes_to_responders_only():
    _reset()
    S.h_join(["R", "", "Responder 1"], "RESP", "RESP", 0, None)
    tok = S.WATCH_REGISTRY[0]["token"]
    r = S.gov_wellness({"token": tok, "who": "test"})
    assert r["ok"] and any(t.startswith("WC|") and d == "RESP" for t, d in SENT)


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1
    print(f"{n} passed")
