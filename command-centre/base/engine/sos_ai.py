"""Turn a panicked description, in any language, into MedMesh's emergency form.

    "mi hermano se cayó de la escalera, no responde y sangra mucho de la cabeza, mi mamá también está herida"
 -> count 2, person 1: fall, not responding, heavy bleeding;  person 2: injured, details unknown

How it stays honest (not "just an AI wrapper"):
  * Gemini only EXTRACTS what the caller said into a fixed schema (JSON-schema constrained output).
    Anything not said is "unknown". It never diagnoses.
  * Every person carries a short quote of the caller's own words as evidence.
  * The result is validated here (enums, counts, lengths) and then shown to the caller to confirm or fix.
  * Unknowns are treated as possibly serious by triage, so missing information moves people UP the queue.
  * With no internet, a small multilingual keyword reader fills what it can and the caller's words are still
    sent to the command centre as they are.
"""
import base64
import json
import os
import re
import urllib.error
import urllib.request

API = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")   # override only for tests
DEFAULT_MODEL = "gemini-3.8-flash"
YNU = ["yes", "no", "unknown"]
COMPLAINTS = ["CP", "BR", "BL", "BU", "UN", "PR", "FX", "OT"]
INCIDENTS = ["crash", "fall", "fire", "flood", "collapse", "violence", "medical", "other", "unknown"]

SCHEMA = {
    "type": "object",
    "properties": {
        "language": {"type": "string", "description": "Language the caller used, e.g. Spanish"},
        "translation_en": {"type": "string", "description": "Faithful English translation of what the caller said"},
        "summary": {"type": "string", "description": "One short line for the dispatcher, English"},
        "incident_type": {"type": "string", "enum": INCIDENTS},
        "location_text": {"type": "string", "description": "Place words the caller used, or empty"},
        "count": {"type": "integer", "description": "How many people need help, as stated or clearly implied; 1 if one person"},
        "caller_is_patient": {"type": "boolean"},
        "people": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "description": "How the caller referred to them, e.g. 'my brother'"},
                    "age_group": {"type": "string", "enum": ["child", "adult", "senior", "unknown"]},
                    "walk": {"type": "string", "enum": YNU},
                    "breathing": {"type": "string", "enum": ["normal", "fast", "none", "unknown"]},
                    "responds": {"type": "string", "enum": YNU},
                    "bleeding": {"type": "string", "enum": YNU, "description": "HEAVY bleeding"},
                    "complaint": {"type": "string", "enum": COMPLAINTS},
                    "trapped": {"type": "boolean"},
                    "note": {"type": "string", "description": "Other important facts for paramedics, English, short"},
                    "evidence": {"type": "string", "description": "Short quote of the caller's own words about this person"},
                },
                "required": ["age_group", "walk", "breathing", "responds", "bleeding", "complaint", "evidence"],
            },
        },
    },
    "required": ["language", "translation_en", "summary", "incident_type", "count", "people"],
}

PROMPT = """You help a bystander in a disaster report an emergency. They may be panicking and may write or speak in any language.
Fill the form from what they said. Rules:
- Use ONLY what was said or clearly implied. Anything not mentioned is "unknown". Never guess, never diagnose.
- One entry in "people" per injured person mentioned, most serious first. If they say "3 people hurt" but describe
  only one, set count 3 and describe the one; the others will be asked about separately.
- complaint codes: CP chest pain, BR breathing problem, BL bleeding or injury, BU burn, UN unconscious or not responding,
  PR pregnancy or labour, FX fall or broken bone, OT other or unclear.
- breathing: "none" only if they say the person is not breathing; "fast" if struggling/gasping.
- bleeding = heavy bleeding only.
- "evidence": copy a few of the caller's own words (original language) about that person.
- translation_en: faithful translation, keep it short. summary: one line for a dispatcher.
"""


# ---------------------------------------------------------------- Gemini
def _post(url, key, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _text_of(resp):
    for c in resp.get("candidates") or []:
        for p in (c.get("content") or {}).get("parts") or []:
            if p.get("text"):
                return p["text"]
    return ""


def gemini_interpret(text=None, audio=None, mime=None, key=None, model=None, timeout=25):
    key = key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("no GEMINI_API_KEY")
    model = model or os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    parts = []
    if audio:
        parts.append({"inline_data": {"mime_type": mime or "audio/m4a", "data": audio if isinstance(audio, str) else base64.b64encode(audio).decode()}})
    if text:
        parts.append({"text": f"What the caller said:\n{text[:2000]}"})
    parts.append({"text": PROMPT})
    url = f"{API}/models/{model}:generateContent"
    last = None
    for cfg_key in ("responseJsonSchema", "responseSchema"):
        body = {"contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json", cfg_key: SCHEMA, "temperature": 0}}
        try:
            raw = _text_of(_post(url, key, body, timeout))
            m = re.search(r"\{.*\}", raw, re.S)
            return json.loads(m.group(0) if m else raw), model
        except urllib.error.HTTPError as e:
            last = e
            if e.code != 400:
                break
    raise RuntimeError(f"Gemini failed: {last}")


# ---------------------------------------------------------------- offline keyword reader
_NUM = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "deux": 2, "trois": 3, "quatre": 4, "dos": 2, "tres": 3,
        "cuatro": 4, "do": 2, "teen": 3, "char": 4, "several": 3, "many": 5, "plusieurs": 3, "varios": 3}
_KW = {
    "none": r"not breathing|no breathing|isn'?t breathing|ne respire (pas|plus)|no respira|saans nahi",
    "fast": r"can'?t breathe|cannot breathe|struggling to breathe|gasping|short of breath|respire mal|no puede respirar|saans",
    "unresp": r"unconscious|not respond|unresponsive|passed out|fainted|inconscient|ne r[ée]pond pas|inconsciente|no responde|behosh",
    "bleed": r"bleeding (a lot|heavily|badly)|lots of blood|heavy bleeding|blood everywhere|saigne beaucoup|sangra mucho|sangre|khoon",
    "CP": r"chest pain|heart attack|douleur (à la|a la) poitrine|dolor de pecho|crise cardiaque|seene mein dard",
    "BU": r"burn|burned|burnt|br[uû]l|quemad|jal gaya",
    "PR": r"pregnan|labou?r|contractions|enceinte|embarazada|pregnent",
    "FX": r"broken|fracture|fell|fall|tomb[ée]|se cay[óo]|ca[ií]da|gir gaya",
    "trap": r"trapped|stuck|pinned|coinc[ée]|atrapad|phans",
    "walk": r"can walk|walking|peut marcher|puede caminar",
    "child": r"child|kid|baby|enfant|b[ée]b[ée]|niñ|bacha|bachcha",
    "senior": r"elderly|old (man|woman|lady)|grand(ma|pa|mother|father)|personne [âa]g[ée]e|ancian|dadi|nani|dada",
}


def rules_interpret(text):
    t = (text or "").lower()
    has = lambda k: re.search(_KW[k], t) is not None  # noqa: E731
    count = 1
    m = re.search(r"\b(\d{1,2})\s*(people|persons|injured|hurt|personnes|bless[ée]s|personas|heridos|log)\b", t)
    if m:
        count = int(m.group(1))
    else:
        for w, n in _NUM.items():
            if re.search(rf"\b{w}\b\s*(people|persons|injured|hurt|personnes|bless|personas|herid|log)", t):
                count = n
                break
    complaint = next((k for k in ("CP", "BU", "PR", "FX") if has(k)), None)
    if has("unresp"):
        complaint = complaint or "UN"
    if has("none") or has("fast"):
        complaint = complaint or "BR"
    if has("bleed"):
        complaint = complaint or "BL"
    person = {
        "label": "", "age_group": "child" if has("child") else "senior" if has("senior") else "unknown",
        "walk": "yes" if has("walk") else "unknown",
        "breathing": "none" if has("none") else "fast" if has("fast") else "unknown",
        "responds": "no" if has("unresp") else "unknown",
        "bleeding": "yes" if has("bleed") else "unknown",
        "complaint": complaint or "OT", "trapped": has("trap"), "note": "trapped" if has("trap") else "",
        "evidence": (text or "")[:100],
    }
    return {"language": "unknown", "translation_en": "", "summary": (text or "")[:120],
            "incident_type": "unknown", "location_text": "", "count": max(1, count), "caller_is_patient": False,
            "people": [person]}


# ---------------------------------------------------------------- validation
def _enum(v, allowed, default):
    return v if v in allowed else default


def normalise(raw):
    r = raw if isinstance(raw, dict) else {}
    clean = lambda v, n=160: re.sub(r"\s+", " ", v).strip()[:n] if isinstance(v, str) else ""  # noqa: E731
    people = []
    for p in (r.get("people") or [])[:10]:
        if not isinstance(p, dict):
            continue
        people.append({
            "label": clean(p.get("label"), 40),
            "age_group": _enum(p.get("age_group"), ["child", "adult", "senior", "unknown"], "unknown"),
            "walk": _enum(p.get("walk"), YNU, "unknown"),
            "breathing": _enum(p.get("breathing"), ["normal", "fast", "none", "unknown"], "unknown"),
            "responds": _enum(p.get("responds"), YNU, "unknown"),
            "bleeding": _enum(p.get("bleeding"), YNU, "unknown"),
            "complaint": _enum(p.get("complaint"), COMPLAINTS, "OT"),
            "trapped": p.get("trapped") is True,
            "note": clean(p.get("note"), 80),
            "evidence": clean(p.get("evidence"), 100),
        })
    try:
        count = int(r.get("count") or 1)
    except (TypeError, ValueError):
        count = 1
    count = max(1, min(50, max(count, len(people))))
    return {
        "language": clean(r.get("language"), 30) or "unknown",
        "translation_en": clean(r.get("translation_en"), 400),
        "summary": clean(r.get("summary"), 160),
        "incident_type": _enum(r.get("incident_type"), INCIDENTS, "unknown"),
        "location_text": clean(r.get("location_text"), 80),
        "count": count,
        "caller_is_patient": r.get("caller_is_patient") is True,
        "people": people or [rules_interpret("")["people"][0]],
    }


def interpret(text=None, audio=None, mime=None):
    """Gemini when there is a key and a connection; otherwise the keyword reader. Always validated."""
    try:
        raw, model = gemini_interpret(text, audio, mime)
        return {"source": "gemini", "model": model, "result": normalise(raw)}
    except Exception as e:  # no key, no internet, or a bad answer
        if not text:
            return {"source": "none", "error": "Could not understand the recording offline. Please type it.", "result": None}
        return {"source": "rules", "note": str(e)[:120], "result": normalise(rules_interpret(text))}


# ---------------------------------------------------------------- to the wire format
def triage_of(p):
    """START, with unknowns treated as possibly serious (never down-grades someone)."""
    if p["walk"] == "yes":
        return 3
    if p["breathing"] in ("none", "fast", "unknown") or p["responds"] in ("no", "unknown") or p["bleeding"] in ("yes", "unknown"):
        return 1
    return 2


def flags_of(p):
    """4-char flags for R|: walks · breathing N/F/X · responds · heavy bleeding. Unknowns map to the more serious value."""
    return ("1" if p["walk"] == "yes" else "0") + {"normal": "N", "fast": "F", "none": "X"}.get(p["breathing"], "F") + \
        ("1" if p["responds"] == "yes" else "0") + ("0" if p["bleeding"] == "no" else "1")
