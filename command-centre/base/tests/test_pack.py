"""Emergency pack: translation checks and audio (Gemini mocked; no network)."""
import os, sys, base64
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine import pack_ai

ITEMS = [{"id": "cpr1", "text": "Push hard and fast in the centre of the chest, 100 to 120 times a minute."},
         {"id": "cpr2", "text": "Push down about 5 cm."}]


def test_numbers_must_survive():
    assert pack_ai.check("Push 5 cm.", {"text": "5 सेमी दबाएँ", "back": "Press 5 cm"})
    assert not pack_ai.check("Push 5 cm.", {"text": "दबाएँ", "back": "Press"})
    assert not pack_ai.check("100 to 120 a minute", {"text": "100 से 120", "back": "100 to 12 a minute"})
    assert pack_ai.check("Push 5 cm.", {"text": "५ सेमी दबाएँ", "back": "Press 5 cm"})   # Devanagari digit


def test_wav_header():
    w = pack_ai.pcm_to_wav(b"\x00\x00" * 10)
    assert w[:4] == b"RIFF" and w[8:12] == b"WAVE" and len(w) == 44 + 20


def test_build_pack_falls_back_per_line(monkeypatch=None):
    def fake_translate(lines, language, key, model):
        return {"cpr1": {"id": "cpr1", "text": "ਛਾਤੀ ਦੇ ਵਿਚਕਾਰ 100 ਤੋਂ 120 ਵਾਰ ਦਬਾਓ", "back": "Press the middle of the chest 100 to 120 times"},
                "cpr2": {"id": "cpr2", "text": "ਜ਼ੋਰ ਨਾਲ ਦਬਾਓ", "back": "Press hard"}}   # lost the 5: must fall back
    pack_ai.translate, orig_t = fake_translate, pack_ai.translate
    pack_ai.speak, orig_s = (lambda text, key, model=None, voice=None: pack_ai.pcm_to_wav(b"\x01\x00" * 8)), pack_ai.speak
    try:
        out = pack_ai.build_pack("Punjabi", ITEMS, ["cpr1"], key="test")
    finally:
        pack_ai.translate, pack_ai.speak = orig_t, orig_s
    by = {i["id"]: i for i in out["items"]}
    assert by["cpr1"]["ok"] and "120" in by["cpr1"]["text"]
    assert not by["cpr2"]["ok"] and by["cpr2"]["text"] == ITEMS[1]["text"]
    assert out["checks"]["fallback"] == ["cpr2"]
    assert base64.b64decode(out["audio"]["cpr1"])[:4] == b"RIFF"


def test_no_key_returns_english():
    os.environ.pop("GEMINI_API_KEY", None)
    out = pack_ai.build_pack("Tamil", ITEMS, ["cpr1"])
    assert out["source"] == "none" and out["items"][0]["text"] == ITEMS[0]["text"]


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("PASS", k)
    print(f"{n} tests passed")
