"""Clinical routing rules: what care a patient needs and how fast it matters.

This is decision SUPPORT for routing, not diagnosis. Triage itself is START (rule-based, in logic.py).

Each complaint maps to
  need   capability the destination must have (hard filter; relaxed only if nobody has it)
  tau    time constant (minutes) of the outcome curve P(good outcome | delay t) = exp(-t / tau)

Time-critical conditions (cardiac, major trauma, airway) have short tau, so every minute of delay costs a lot;
minor complaints have long tau, so the engine is free to trade a longer drive for a much shorter wait.
The tau values are MODELLING ASSUMPTIONS chosen to encode "faster matters more for these", tuned for the demo;
they are deliberately visible in the decision panel, not hidden.
"""
import math

# capability codes: C cardiac, T trauma, B burns, O obstetrics, P paediatrics
COMPLAINT = {
    "CP": {"label": "Chest pain", "need": "C", "tau": 60},
    "BR": {"label": "Breathing difficulty", "need": "", "tau": 30},
    "UN": {"label": "Unconscious", "need": "", "tau": 45},
    "BL": {"label": "Bleeding / injury", "need": "T", "tau": 60},
    "BU": {"label": "Burn", "need": "B", "tau": 120},
    "PR": {"label": "Pregnancy", "need": "O", "tau": 90},
    "FX": {"label": "Fracture / fall", "need": "T", "tau": 240},
    "OT": {"label": "Other", "need": "", "tau": 480},
}

# START triage -> queue class (0 seen first), outcome weight, tau multiplier, whether a clinic may take them
TRIAGE = {
    1: {"name": "IMMEDIATE", "klass": 0, "weight": 10.0, "tau_x": 1.0, "clinic_ok": False, "needs_bed": True},
    2: {"name": "DELAYED", "klass": 1, "weight": 3.0, "tau_x": 3.0, "clinic_ok": False, "needs_bed": True},
    3: {"name": "MINOR", "klass": 2, "weight": 1.0, "tau_x": 10.0, "clinic_ok": True, "needs_bed": False},
    4: {"name": "EXPECTANT", "klass": 1, "weight": 2.0, "tau_x": 3.0, "clinic_ok": False, "needs_bed": True},
}

SCENE_MIN = {1: 10, 2: 8, 3: 5, 4: 10}  # on-scene time before transport (assumption)


def profile_for(complaint, triage, age="A", risk_flags=()):
    c = COMPLAINT.get(complaint, COMPLAINT["OT"])
    t = TRIAGE.get(triage, TRIAGE[2])
    tau = c["tau"] * t["tau_x"]
    # profile-based adjustments (MedMesh ID) are applied in patient.py
    # minor (green) patients don't need a specialist centre: the capability becomes a soft preference
    need, prefer = (c["need"], "") if triage != 3 else ("", c["need"])
    if age == "C":
        prefer += "P"
    return {"complaint": complaint, "label": c["label"], "need": need, "prefer": prefer,
            "triage": triage, "triage_name": t["name"], "klass": t["klass"], "weight": t["weight"], "tau": tau,
            "clinic_ok": t["clinic_ok"], "needs_bed": t["needs_bed"], "scene_min": SCENE_MIN.get(triage, 8)}


def outcome_loss(profile, minutes_to_treatment):
    """Expected outcome loss in [0, weight]: weight * (1 - exp(-t / tau))."""
    return profile["weight"] * (1.0 - math.exp(-max(0.0, minutes_to_treatment) / profile["tau"]))
