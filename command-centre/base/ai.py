"""Offline AI for the command centre (Ollama, runs locally - no internet).

If Ollama isn't running, every function falls back to a deterministic template,
so the demo never breaks. The AI writes and summarises; it never diagnoses.
Install: https://ollama.com  then:  ollama pull llama3.2:3b
"""
import json, os, urllib.request
from logic import COMPLAINTS, TRIAGE, AGES

MODEL = os.environ.get("MEDMESH_MODEL", "llama3.2:3b")
URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")


def _ollama(prompt, timeout=25):
    body = json.dumps({"model": MODEL, "prompt": prompt, "stream": False,
                       "options": {"temperature": 0.2, "num_predict": 220}}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["response"].strip()


def available():
    try:
        urllib.request.urlopen(URL.replace("/api/generate", "/api/tags"), timeout=1.5)
        return True
    except Exception:
        return False


def _facts(case, profile):
    tri = TRIAGE[case["triage"]][0]
    lines = [f"Triage (START): {tri}", f"Complaint: {COMPLAINTS.get(case['complaint'], case['complaint'])}",
             f"Age group: {AGES.get(case['age'], '?')}", f"People hurt: {case.get('count', 1)}",
             f"Reported at: {case['time']} via mesh, {case.get('hops', '?')} hops"]
    if profile:
        lines += [f"Profile: {profile['name']}, {profile['age']}{profile['sex']}, blood {profile['blood']}",
                  f"Allergies: {', '.join(profile['allergies']) or 'none known'}",
                  f"Conditions: {', '.join(profile['conditions']) or 'none'}",
                  f"Medications: {', '.join(profile['meds']) or 'none'}"]
    ex = case.get("extras") or {}
    if ex:
        lines.append("Bystander-reported: " + ", ".join(f"{k}={v}" for k, v in ex.items()))
    if case.get("hospital"):
        lines.append(f"Destination: {case['hospital_name']}, ETA {case.get('eta')} min")
    return "\n".join(lines)


def template_sbar(case, profile):
    tri = TRIAGE[case["triage"]][0]
    who = f"{profile['age']}{profile['sex']} ({profile['name']})" if profile else AGES.get(case["age"], "Patient")
    s = f"{who}, {COMPLAINTS.get(case['complaint'], 'unspecified').lower()}"
    if case.get("breathing") == "fast": s += ", breathing fast"
    if case.get("responds") is False: s += ", not responding"
    if case.get("bleeding"): s += ", heavy bleeding"
    b = f"Mesh report {case['time']}."
    if profile:
        b += f" Blood {profile['blood']}. Hx: {', '.join(profile['conditions']) or 'none'}. Meds: {', '.join(profile['meds']) or 'none'}. Allergies: {', '.join(profile['allergies']) or 'NKDA'}."
    elif case.get("extras"):
        b += " Bystander-reported: " + ", ".join(f"{k} {v}" for k, v in case["extras"].items()) + "."
    else:
        b += " No history available."
    a = f"START {tri}."
    r = f"Transport to {case.get('hospital_name', 'nearest suitable ER')}" + (f", ETA {case['eta']} min." if case.get("eta") else ".")
    return {"S": s, "B": b, "A": a, "R": r, "by": "template"}


def sbar(case, profile):
    base = template_sbar(case, profile)
    prompt = ("You are a paramedic handoff assistant. Write an SBAR handoff from these facts ONLY. "
              "Do not diagnose; use 'possible' or 'rule out'. Each part one short sentence. "
              "Reply as JSON with keys S,B,A,R.\n\n" + _facts(case, profile))
    try:
        out = _ollama(prompt)
        j = json.loads(out[out.index("{"): out.rindex("}") + 1])
        if all(k in j for k in "SBAR"):
            return {k: str(j[k]) for k in "SBAR"} | {"by": MODEL}
    except Exception:
        pass
    return base


def summary(state):
    cases = [c for c in state["cases"].values() if c["status"] not in ("delivered", "closed")]
    red = sum(1 for c in cases if c.get("triage") == 1)
    hos = state["hospitals"]
    full = [h["name"] for h in hos if h["open"] and h["free"] <= max(1, h["total"] // 10)]
    closed = [h["name"] for h in hos if not h["open"]]
    low = [f"{p['name']} low on {k.lower()}" for p in state["pharmacies"] for k, v in p["stock"].items() if 0 < v <= 3]
    offline = [n["name"] for n in state["nodes"].values() if not n["online"]]
    facts = (f"Active cases: {len(cases)} ({red} IMMEDIATE). Hospitals near capacity: {', '.join(full) or 'none'}. "
             f"Closed: {', '.join(closed) or 'none'}. Blocked roads: {', '.join(state['blocked']) or 'none'}. "
             f"Flood zones: {len(state['floods'])}. Offline nodes: {', '.join(offline) or 'none'}. "
             f"Pharmacy alerts: {', '.join(low) or 'none'}. Pending medication requests: "
             f"{sum(1 for r in state['requests'].values() if r['status'] == 'pending')}.")
    prompt = ("You are a disaster command-centre assistant. In 3 short bullet points, summarise the situation "
              "and suggest the single most useful next action. Use only these facts:\n" + facts)
    try:
        return {"text": _ollama(prompt), "by": MODEL}
    except Exception:
        return {"text": facts, "by": "template"}
