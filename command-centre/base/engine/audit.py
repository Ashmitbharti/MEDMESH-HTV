"""Tamper-evident audit log of every dispatch decision.

Each record stores the decision (inputs, all candidates with their factors, the choice and the reasons) plus
the SHA-256 hash of the previous record. Editing any past record breaks every hash after it, which `verify()`
detects. When connectivity returns, the latest hash can be published (e.g. on-chain) so the whole disaster
log can be proven unchanged afterwards. Stored as JSON Lines, append-only.
"""
import hashlib
import json
import os
import threading
import time


class AuditLog:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.head = "0" * 64
        self.count = 0
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    if line.strip():
                        self.head = json.loads(line)["hash"]
                        self.count += 1

    def append(self, kind, payload):
        with self.lock:
            body = {"seq": self.count + 1, "ts": time.time(), "kind": kind, "prev": self.head, "data": payload}
            raw = json.dumps(body, sort_keys=True, default=str)
            h = hashlib.sha256(raw.encode()).hexdigest()
            with open(self.path, "a") as f:
                f.write(json.dumps({**body, "hash": h}, default=str) + "\n")
            self.head, self.count = h, self.count + 1
            return h

    def verify(self):
        prev, n = "0" * 64, 0
        if not os.path.exists(self.path):
            return {"ok": True, "records": 0, "head": prev}
        with open(self.path) as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                h = rec.pop("hash")
                if rec["prev"] != prev or hashlib.sha256(json.dumps(rec, sort_keys=True, default=str).encode()).hexdigest() != h:
                    return {"ok": False, "records": n, "broken_at": rec["seq"]}
                prev, n = h, n + 1
        return {"ok": True, "records": n, "head": prev}

    def tail(self, n=50):
        if not os.path.exists(self.path):
            return []
        with open(self.path) as f:
            lines = f.readlines()[-n:]
        return [json.loads(l) for l in lines if l.strip()]
