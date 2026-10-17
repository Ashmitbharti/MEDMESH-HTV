"""Personal offline emergency pack: Gemini translates and voices MedMesh's checked first-aid scripts.

Safety design
  * Gemini never writes medical advice. The app sends our own reviewed English lines (already chosen and personalised
    by fixed rules from the MedMesh ID: e.g. blood thinners -> press longer). Gemini only translates and speaks them.
  * Every translated line comes back with a back-translation to English, and this module checks deterministically
    that every number (5 cm, 100-120 a minute, 10 minutes...) survived. A line that fails falls back to English.
  * Audio is generated while the phone is online (MedMesh ID setup) and stored on the phone, so it plays offline.
"""
import base64
import concurrent.futures as cf
import json
import os
import re
import struct
import unicodedata
import urllib.error
import urllib.request

API = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")   # override only for tests
TEXT_MODEL = "gemini-3.8-flash"
TTS_MODEL = "gemini-2.5-flash-preview-tts"
VOICE = "Kore"

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "text": {"type": "string", "description": "The line translated into the target language"},
                    "back": {"type": "string", "description": "Your translation translated back into English, literally"},
                },
                "required": ["id", "text", "back"],
            },
        },
    },
    "required": ["items"],
}

PROMPT = """Translate these first-aid instructions into {language} for someone in an emergency.
Rules:
- Translate faithfully. Do NOT add, remove, soften or change any step, warning or number.
- Keep every number exactly (write them as digits).
- Use simple, calm, everyday words a frightened person understands. Address the reader directly.
- For each line also give "back": your translation translated back into plain English, literally.
Return one item per input id.

Lines (JSON):
{lines}"""

_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def numbers(text):
    """Numbers in a line, with any script's digits (e.g. ५, ੫) normalised to 0-9."""
    norm = "".join(str(unicodedata.digit(ch)) if ch.isdigit() else ch for ch in (text or ""))
    return sorted(n.replace(",", ".") for n in _NUM.findall(norm))


def check(src, item):
    """A translation passes only if every number in the English line appears in both the translation and the back-translation."""
    want = numbers(src)
    return numbers(item.get("text")) == want and numbers(item.get("back")) == want and bool((item.get("text") or "").strip())


def _post(url, key, body, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def translate(lines, language, key, model):
    payload = json.dumps([{"id": i, "text": t} for i, t in lines], ensure_ascii=False)
    parts = [{"text": PROMPT.format(language=language, lines=payload)}]
    for cfg in ("responseJsonSchema", "responseSchema"):
        try:
            r = _post(f"{API}/models/{model}:generateContent", key, {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json", cfg: SCHEMA, "temperature": 0},
            })
            raw = next((p["text"] for c in r.get("candidates", []) for p in c.get("content", {}).get("parts", []) if p.get("text")), "")
            m = re.search(r"\{.*\}", raw, re.S)
            return {it["id"]: it for it in json.loads(m.group(0) if m else raw).get("items", []) if isinstance(it, dict) and "id" in it}
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    raise RuntimeError("translation request rejected")


def pcm_to_wav(pcm, rate=24000, channels=1, bits=16):
    byte_rate = rate * channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate,
                                                                                    channels * bits // 8, bits) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def speak(text, key, model=None, voice=None):
    """Gemini text-to-speech -> WAV bytes."""
    r = _post(f"{API}/models/{model or os.environ.get('GEMINI_TTS_MODEL', TTS_MODEL)}:generateContent", key, {
        "contents": [{"parts": [{"text": f"Say calmly and clearly, like a kind paramedic: {text}"}]}],
        "generationConfig": {"responseModalities": ["AUDIO"],
                             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or VOICE}}}},
    }, timeout=60)
    part = next(p for c in r.get("candidates", []) for p in c.get("content", {}).get("parts", []) if p.get("inlineData") or p.get("inline_data"))
    data = part.get("inlineData") or part.get("inline_data")
    pcm = base64.b64decode(data["data"])
    m = re.search(r"rate=(\d+)", data.get("mimeType", data.get("mime_type", "")))
    return pcm if pcm[:4] == b"RIFF" else pcm_to_wav(pcm, int(m.group(1)) if m else 24000)


def build_pack(language, items, voice_ids=(), key=None):
    """items: [{"id", "text"}] in English. Returns translated items (checked) and WAV audio (base64) for voice_ids."""
    key = key or os.environ.get("GEMINI_API_KEY")
    lines = [(str(i["id"]), str(i["text"])[:400]) for i in items][:120]
    english = language.strip().lower() in ("", "english", "en")
    out = {"language": language, "source": "none", "items": [], "audio": {}, "checks": {"passed": 0, "fallback": []}}
    if not key:
        out["error"] = "No Gemini key on the command centre"
        out["items"] = [{"id": i, "text": t, "back": t, "ok": True, "english": True} for i, t in lines]
        return out
    model = os.environ.get("GEMINI_MODEL", TEXT_MODEL)
    tr = {} if english else translate(lines, language, key, model)
    for i, t in lines:
        it = tr.get(i)
        if english:
            out["items"].append({"id": i, "text": t, "back": t, "ok": True})
        elif it and check(t, it):
            out["items"].append({"id": i, "text": it["text"].strip(), "back": it["back"].strip(), "ok": True})
            out["checks"]["passed"] += 1
        else:  # meaning or numbers changed: keep the checked English line
            out["items"].append({"id": i, "text": t, "back": (it or {}).get("back", ""), "ok": False, "english": True})
            out["checks"]["fallback"].append(i)
    out["source"] = "gemini"
    out["model"] = model
    want = {str(v) for v in voice_ids}
    todo = [x for x in out["items"] if x["id"] in want]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(speak, x["text"], key): x["id"] for x in todo}
        for fu in cf.as_completed(futs):
            try:
                out["audio"][futs[fu]] = base64.b64encode(fu.result()).decode()
            except Exception as e:  # noqa: BLE001 - one failed clip falls back to the phone's own voice
                out.setdefault("audio_errors", {})[futs[fu]] = str(e)[:80]
    return out
