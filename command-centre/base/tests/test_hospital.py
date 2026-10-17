"""Hospital device: bed updates, 'ready' and 'full' answers, incoming-patient messages."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy
import server as S
from data import HOSPITALS

SENT = []


def _reset():
    SENT.clear()
    S.send = lambda text, dest=None, kind="": SENT.append((text, dest))
    S.S.update({"hospitals": copy.deepcopy(HOSPITALS), "cases": {}, "roles": {}})
    S.h_join(["H", "CEN", "Centenary"], "HOSP_CEN", "HOSP_CEN", 0, None)


def test_bed_update_with_wait_and_note():
    _reset()
    S.h_hospital(["CEN", "3", "1", "CTB", "1", "45", "Neurosurgeon on call"], "HOSP_CEN", "HOSP_CEN", 0, None)
    h = S.hosp("CEN")
    assert (h["free"], h["icu"], h["caps"], h["er_wait"], h["note"]) == (3, 1, "CTB", 45, "Neurosurgeon on call")
    assert ("A|C|OK", "HOSP_CEN") in SENT


def test_incoming_message_reaches_the_hospital_device():
    _reset()
    S.h_hospital(["SGH", "0", "0", "CTD", "0"], "x", "x", 0, None)
    S.h_hospital(["BIR", "0", "0", "T", "0"], "x", "x", 0, None)
    S.h_report(["p1", "1", "CP", "A", "1", "0F11", "43.7790,-79.2100", "", "BG:O-;AL:Penicillin"], "FIELD", "FIELD", 0, ["FIELD", "BASE"])
    msgs = [t for t, d in SENT if d == "HOSP_CEN" and t.startswith("I|p1|")]
    assert msgs and "BG:O-" in msgs[0] and "AL:Penicillin" in msgs[0]


def test_full_diverts_patients_not_yet_picked_up():
    _reset()
    S.h_hospital(["SGH", "5", "1", "CTD", "1"], "x", "x", 0, None)
    S.h_report(["p2", "2", "FX", "S", "1", "0N10", "43.7790,-79.2100", "", ""], "FIELD", "FIELD", 0, ["FIELD", "BASE"])
    c = S.S["cases"]["p2"]
    if c["hospital"] != "CEN":          # make sure it starts at Centenary
        c["hospital"] = "CEN"
    S.h_hospital_ack(["p2", "FULL"], "HOSP_CEN", "HOSP_CEN", 0, None)
    assert S.hosp("CEN")["open"] is False
    assert S.S["cases"]["p2"]["hospital"] != "CEN"


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1
    print(f"{n} passed")
