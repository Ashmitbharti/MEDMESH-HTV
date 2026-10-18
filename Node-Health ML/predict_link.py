"""Live link-health score for one node from the tail of a packet log (collect_min.py output or a replay).

python predict_link.py '!a1b2c302'                              # newest log in data/raw/, at the log's last packet
python predict_link.py '!a1b2c302' --log data/raw/walkout_01.csv --now wall    # at the current clock time
python predict_link.py --all --log results/replay/demo_replay_log.csv

from predict_link import link_risk
link_risk("!a1b2c302")   -> {"A": 0.73, "alert": "WATCH", "top_features": [...], ...}

A = model probability that the node's link fails (>= 90 s of silence) within 120 s (common.HORIZON).
Alert: WARNING if A >= WARNING threshold, WATCH if A >= WATCH, else NONE. If the node has already been
silent >= 90 s the failure is no longer a prediction: status SILENT and alert WARNING regardless of A.
"""
import argparse
import io
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

from common import MODELS_DIR, RAW_DIR, SILENCE_FAIL, node_arrays, node_features_at, prepare_log

_CACHE = {}
SKIP = ("_events.csv", "_nodes.csv", "_acks.csv")


def load_model(path=None):
    path = Path(path or MODELS_DIR / "linkhealth.joblib")
    if path not in _CACHE:
        _CACHE[path] = joblib.load(path)
    return _CACHE[path]


def newest_log():
    logs = [p for p in RAW_DIR.glob("*.csv") if not p.name.endswith(SKIP)]
    if not logs:
        raise FileNotFoundError(f"no packet logs in {RAW_DIR}")
    return max(logs, key=lambda p: p.stat().st_mtime)


def read_tail(path, tail_bytes=500_000) -> pd.DataFrame:
    """Header + the last `tail_bytes` of the file (whole lines only), so a long-running log stays cheap."""
    with open(path, "rb") as f:
        header = f.readline()
        f.seek(0, 2)
        size = f.tell()
        start = max(len(header), size - tail_bytes)
        f.seek(start)
        body = f.read()
    if start > len(header):
        body = body.split(b"\n", 1)[1] if b"\n" in body else b""
    return prepare_log(pd.read_csv(io.BytesIO(header + body), dtype={"from_id": str, "to_id": str}))


def _to_epoch(now, log):
    if now is None:
        return float(log["t"].max())            # replay / offline: "now" = last packet in the log
    if now == "wall":
        return time.time()
    if isinstance(now, (int, float)):
        return float(now)
    return pd.Timestamp(now).timestamp()


def link_risk(node_id, log_path=None, model_path=None, now=None, top_k=3, log=None):
    m = load_model(model_path)
    log_path = Path(log_path) if log_path else (None if log is not None else newest_log())
    log = log if log is not None else read_tail(log_path)
    t = _to_epoch(now, log)
    log = log[log["t"] <= t]
    out = dict(node_id=node_id, at_utc=datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds"),
               model=m["model"], dataset=m["dataset"], simulated_training=m.get("simulated", True),
               thresholds=dict(WATCH=m["watch"], WARNING=m["warning"]), log=str(log_path) if log_path else None)
    a = node_arrays(log, node_id)
    if not len(a["ts"]):
        return out | dict(A=None, alert="WARNING", status="NO_DATA", top_features=[],
                          reason="no packets from this node in the log tail")
    f = node_features_at(a, t)
    x = pd.DataFrame([f])[m["features"]]
    pipe = m["pipeline"]
    A = float(pipe.predict_proba(x)[0, 1])
    # contribution = how much A drops if this feature is set to its typical (train median) value
    contrib = []
    for c in m["features"]:
        x2 = x.copy()
        x2[c] = m["train_medians"][c]
        contrib.append((c, A - float(pipe.predict_proba(x2)[0, 1])))
    contrib.sort(key=lambda kv: kv[1], reverse=True)
    top = [dict(feature=c, value=None if pd.isna(f[c]) else round(float(f[c]), 3),
                typical=round(float(m["train_medians"][c]), 3), contribution=round(d, 4))
           for c, d in contrib[:top_k] if d > 0]
    alert = "WARNING" if A >= m["warning"] else "WATCH" if A >= m["watch"] else "NONE"
    status = "OK"
    sssl = f["seconds_since_last_packet"]
    if sssl >= SILENCE_FAIL:
        alert, status = "WARNING", "SILENT"
    return out | dict(A=round(A, 4), alert=alert, status=status, top_features=top,
                      seconds_since_last_packet=round(sssl, 1),
                      snr_mean_30s=None if pd.isna(f["snr_mean_30s"]) else round(f["snr_mean_30s"], 2),
                      rssi_mean_30s=None if pd.isna(f["rssi_mean_30s"]) else round(f["rssi_mean_30s"], 1),
                      features={k: (None if pd.isna(v) else round(float(v), 4)) for k, v in f.items()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("node_id", nargs="?")
    ap.add_argument("--log", default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--now", default=None, help="ISO time, epoch seconds or 'wall'; default = last packet in log")
    ap.add_argument("--all", action="store_true", help="score every node in the log")
    a = ap.parse_args()
    now = float(a.now) if a.now and a.now.replace(".", "").isdigit() else a.now
    if a.all:
        log_path = Path(a.log) if a.log else newest_log()
        log = read_tail(log_path)
        res = [link_risk(n, log_path, a.model, now, log=log) for n in log["from_id"].dropna().unique()]
        for r in res:
            r.pop("features", None)
        print(json.dumps(res, indent=1))
    else:
        if not a.node_id:
            ap.error("give a node_id or --all")
        print(json.dumps(link_risk(a.node_id, a.log, a.model, now), indent=1))


if __name__ == "__main__":
    main()
