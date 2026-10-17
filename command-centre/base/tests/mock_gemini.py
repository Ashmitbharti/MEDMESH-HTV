"""A stand-in for the Gemini API, for end-to-end tests without a key or internet.
Answers generateContent in Gemini's response format for MedMesh's four uses:
  * first-aid translation (pretend-Punjabi, numbers kept), * text-to-speech (a short WAV-able PCM tone),
  * SOS form filling, * after-action review findings.
Run:  python3 tests/mock_gemini.py 8790     then start server.py with
      GEMINI_API_KEY=test GEMINI_API_BASE=http://localhost:8790/v1beta
"""
import base64
import json
import math
import re
import struct
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def text_reply(obj):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj, ensure_ascii=False)}]}}]}


def tone(seconds=0.6, rate=24000):
    pcm = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(int(rate * seconds)))
    return {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": f"audio/L16;codec=pcm;rate={rate}", "data": base64.b64encode(pcm).decode()}}]}}]}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        cfg = body.get("generationConfig", {})
        prompt = " ".join(p.get("text", "") for c in body.get("contents", []) for p in c.get("parts", []))
        if "AUDIO" in cfg.get("responseModalities", []):
            out = tone()
        elif "Translate these first-aid" in prompt:
            lines = json.loads(prompt[prompt.index("["):prompt.rindex("]") + 1])
            out = text_reply({"items": [{"id": l["id"], "text": "ਪੰਜਾਬੀ: " + l["text"], "back": l["text"]} for l in lines]})
        elif "What the caller said" in prompt:
            out = text_reply({"language": "Spanish", "translation_en": "Car crash, 3 people hurt, my brother is not responding and bleeding a lot",
                              "summary": "Road crash, 3 injured, 1 unresponsive with heavy bleeding", "incident_type": "crash",
                              "location_text": "", "count": 3, "caller_is_patient": False, "people": [
                                  {"label": "brother", "age_group": "adult", "walk": "no", "breathing": "unknown", "responds": "no",
                                   "bleeding": "yes", "complaint": "UN", "trapped": False, "note": "", "evidence": "mi hermano no responde y sangra mucho"}]})
        elif "after-action review" in prompt:
            keys = re.findall(r"hospital:[A-Z]+", prompt)
            out = text_reply({"headline": "Fast dispatch; one hospital ran hot", "next_drill": "Close Centenary at minute 5 and flood Ellesmere Rd.",
                              "findings": [{"title": "Centenary carried the most serious patients", "detail": "Most immediate cases went there.",
                                            "recommendation": "Pre-stage two extra beds at Centenary when a storm warning starts.", "owner": "hospitals",
                                            "evidence": ["hospitals"] + keys[:1]},
                                           {"title": "Invented claim", "detail": "x", "recommendation": "y", "evidence": ["case:nope"]}]})
        elif "Write a mitigation deck" in prompt:
            areas = re.findall(r"area:[A-Z]{3}", prompt)
            a = areas[0] if areas else "area:MLV"
            out = text_reply({"headline": "Oxygen and silence are the risks to plan for", "summary": "Most registered oxygen users live where radio coverage is thinnest.",
                              "slides": [{"title": "Malvern first", "area": a, "problem": "Many oxygen users, far from a working node.",
                                          "actions": [{"action": "Install a solar relay node on a school roof.", "owner": "mesh team", "when": "before", "evidence": [a]},
                                                      {"action": "Made-up claim", "owner": "city", "when": "before", "evidence": ["area:XXX"]}]},
                                         {"title": "City-wide", "area": "", "problem": "Registry is small.",
                                          "actions": [{"action": "Sign-up drive at pharmacies.", "owner": "public health", "when": "before", "evidence": ["response"]}]}]})
        else:
            out = {"error": "unknown request"}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8790), H).serve_forever()
