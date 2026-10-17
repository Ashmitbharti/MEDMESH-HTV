"""Checks for the any-language SOS reader (no network needed)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine import sos_ai


def test_unknowns_never_downgrade():
    p = sos_ai.normalise({"people": [{}]})["people"][0]
    assert sos_ai.triage_of(p) == 1 and sos_ai.flags_of(p) == "0F01"


def test_walking_is_minor():
    p = sos_ai.normalise({"people": [{"walk": "yes"}]})["people"][0]
    assert sos_ai.triage_of(p) == 3


def test_count_at_least_people():
    r = sos_ai.normalise({"count": 1, "people": [{"walk": "yes"}, {"walk": "no"}]})
    assert r["count"] == 2


def test_bad_enums_are_cleaned():
    r = sos_ai.normalise({"incident_type": "alien", "people": [{"complaint": "ZZ", "breathing": "maybe"}]})
    assert r["incident_type"] == "unknown" and r["people"][0]["complaint"] == "OT" and r["people"][0]["breathing"] == "unknown"


def test_rules_spanish():
    r = sos_ai.normalise(sos_ai.rules_interpret("mi hermano se cayó, no responde y sangra mucho"))
    p = r["people"][0]
    assert p["responds"] == "no" and p["bleeding"] == "yes" and p["complaint"] == "FX"


def test_rules_count_english():
    r = sos_ai.normalise(sos_ai.rules_interpret("car crash, 3 people hurt, one is not breathing"))
    assert r["count"] == 3 and r["people"][0]["breathing"] == "none"


def test_interpret_falls_back_without_key():
    os.environ.pop("GEMINI_API_KEY", None)
    out = sos_ai.interpret(text="she can't breathe")
    assert out["source"] == "rules" and out["result"]["people"][0]["breathing"] == "fast"


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("PASS", k)
    print(f"{n} tests passed")
