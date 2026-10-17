"""Pre-disaster medical profile (MedMesh ID) -> routing adjustments.

Before any disaster, a person fills in their MedMesh profile in the app (conditions, medications, allergies,
devices they depend on, optionally their usual hospital) and syncs it to the command centre while there is
still a network. During the emergency only the 6-character ID travels over the mesh; the command centre looks
the profile up OFFLINE and this module turns it into concrete routing changes:

  need     extra capability the destination MUST have (e.g. obstetrics for a pregnant patient who is bleeding)
  prefer   capabilities that earn a soft bonus (e.g. cardiac care for a known heart patient)
  tau_x    multiplier on the outcome time-constant (< 1 = time matters even more for this person)
  weight_x multiplier on the patient's priority weight
  home     the patient's usual hospital (their records and specialists are there): small bonus
  reasons  plain-language explanations shown in the decision panel

Rules are deliberately transparent keyword rules over the profile, not a black box, and every rule that fires
is shown to the dispatcher. They support routing and preparation; they are not a diagnosis.
"""

ANTICOAG = ("warfarin", "apixaban", "rivaroxaban", "dabigatran", "edoxaban", "heparin", "eliquis", "xarelto", "coumadin",
            "blood thinner", "anticoagulant", "clopidogrel", "plavix", "ticagrelor")
HEART = ("heart failure", "atrial fibrillation", "coronary", "angina", "heart attack", "myocardial", "pacemaker", "heart")
LUNG = ("asthma", "copd", "emphysema", "pulmonary fibrosis")
KIDNEY = ("kidney", "renal", "dialysis", "ckd")
OXYGEN = ("home oxygen", "oxygen concentrator", "oxygen", "cpap", "ventilator")


def _has(text, words):
    return any(w in text for w in words)


def patient_modifiers(profile, complaint, triage):
    out = {"need": "", "prefer": "", "tau_x": 1.0, "weight_x": 1.0, "home": None, "reasons": [], "age": None}
    if not profile:
        return out
    conds = " ".join(profile.get("conditions") or []).lower()
    meds = " ".join(profile.get("meds") or []).lower()
    devices = " ".join(profile.get("devices") or []).lower()
    age = profile.get("age")
    out["age"] = age
    out["home"] = profile.get("home_hospital")
    if out["home"]:
        out["reasons"].append(f"Usual hospital on file: {out['home']} (records and specialists there)")

    def add(reason, need="", prefer="", tau=1.0, weight=1.0):
        out["need"] += need
        out["prefer"] += prefer
        out["tau_x"] *= tau
        out["weight_x"] *= weight
        out["reasons"].append(reason)

    if _has(meds, ANTICOAG) and complaint in ("BL", "FX", "UN"):
        add("On blood thinners: higher bleeding risk, urgency raised, trauma care preferred", prefer="T", tau=0.6, weight=1.5)
    if _has(conds, HEART) and complaint in ("CP", "BR", "UN"):
        add("Known heart condition: cardiac care preferred, time window tightened", prefer="C", tau=0.75)
    if "pregnan" in conds:
        if complaint in ("PR", "BL", "UN", "FX"):
            add("Pregnant: obstetric care required", need="O", tau=0.75)
        else:
            add("Pregnant: obstetric care preferred", prefer="O")
    if _has(conds, LUNG) and complaint == "BR":
        add("Known lung condition with breathing difficulty: time window tightened", tau=0.6, weight=1.3)
    if _has(conds, KIDNEY):
        add("Kidney disease: dialysis-capable hospital preferred", prefer="D")
    if "diabet" in conds and complaint == "UN":
        add("Diabetic and unconscious: possible low blood sugar, check glucose; time window tightened", tau=0.7)
    if "epilep" in conds and complaint == "UN":
        add("Known epilepsy: possible seizure", tau=0.8)
    if _has(conds + " " + devices + " " + meds, OXYGEN):
        add("Depends on oxygen / breathing device: needs a bed with oxygen on arrival", tau=0.8)
    if isinstance(age, (int, float)):
        if age < 18:
            add("Child: paediatric care preferred", prefer="P")
        elif age >= 75 and complaint in ("FX", "UN", "BL"):
            add(f"Age {int(age)}: falls and injuries escalate faster, time window tightened", tau=0.8, weight=1.2)
    comm = [c for c in (profile.get("communication") or []) if c.lower() != "none"]
    if comm:
        out["reasons"].append("Communication needs on file: " + ", ".join(comm) + " (tell the receiving team)")
    for lab in (profile.get("labs") or [])[:3]:
        out["reasons"].append(f"Flagged result from their last report: {lab}")
    for flag in profile.get("risk_flags") or []:   # from the pre-disaster risk screening model
        if flag == "CARDIAC_RISK_HIGH" and complaint in ("CP", "BR", "UN"):
            add("Risk screening flagged high cardiac risk", prefer="C", tau=0.75)
    return out
