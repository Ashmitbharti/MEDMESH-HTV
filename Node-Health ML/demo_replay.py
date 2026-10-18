"""SIMULATED REPLAY: a scripted 3-minute scenario for the demo. Nothing here comes from real radios.

python demo_replay.py               # real time (3 minutes)
python demo_replay.py --speed 20    # 20x faster
python demo_replay.py --model models/big/linkhealth.joblib

Script (fixed before any model was scored on it): node !dem00001 has a steady link (base SNR 6 dB) for the
first 30 s, then is carried away; its SNR falls about 27 dB over 100 s and keeps falling, so packets thin out
and stop. A stable anchor node !dem00000 keeps the log going. Packets are written into a collect_min.py-format
log as simulated time advances and scored every 10 simulated seconds with predict_link.link_risk.
"""
import argparse
import time

import numpy as np
import pandas as pd

from common import RANDOM_STATE, RESULTS_DIR, prepare_log
from predict_link import link_risk
from simulate import FLOOR, T0_BASE, make_episode, simulate_node, to_log

BANNER = "#" * 78 + "\n###  SIMULATED REPLAY - simulated packets, not real radio data  ###\n" + "#" * 78
NODE, ANCHOR = "!dem00001", "!dem00000"
PRE_ROLL = 60          # simulated history before the shown 3 minutes, so the first windows are full
DURATION = 180


def script(rng):
    node = dict(id=NODE, b=6.0, cu=8.0, hops=0)
    ep = dict(scenario="walkout", start=0.0, te=PRE_ROLL + 30, D=100.0, drop=6.0 - FLOOR + 6, v0=4.05,
              event=None, end=1e9)
    anchor = dict(id=ANCHOR, b=7.0, cu=8.0, hops=0)
    T = PRE_ROLL + DURATION + 1
    pk = simulate_node(node, [ep], T, rng)
    pk += simulate_node(anchor, [make_episode("baseline", rng, anchor, 0.0) | dict(end=1e9)], T, rng)
    return pk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", type=float, default=1.0, help="simulated seconds per real second")
    ap.add_argument("--model", default=None)
    a = ap.parse_args()
    rng = np.random.default_rng(RANDOM_STATE)
    full = to_log(script(rng), T0_BASE, rng)
    t_sim = prepare_log(full)["t"].to_numpy() - T0_BASE
    replay_dir = RESULTS_DIR / "replay"
    replay_dir.mkdir(parents=True, exist_ok=True)
    log_path = replay_dir / "demo_replay_log.csv"
    node_times = t_sim[(full.from_id == NODE).to_numpy()]
    last_pkt = float(node_times.max()) - PRE_ROLL
    print(BANNER)
    print(f"SIMULATED REPLAY: node {NODE} fades from t=30 s; speed x{a.speed:g}; log -> {log_path}")
    print(f"{'time':>6} {'node':>10} {'SNR':>7} {'RSSI':>7} {'A':>7}  alert    status  top feature")
    rows, written = [], 0
    for T in range(0, DURATION + 1, 10):
        now = PRE_ROLL + T
        n = int((t_sim <= now).sum())
        full.iloc[:n].to_csv(log_path, index=False)           # the logger has written everything up to now
        written = n
        r = link_risk(NODE, log_path=log_path, model_path=a.model, now=T0_BASE + now)
        top = r["top_features"][0]["feature"] if r["top_features"] else "-"
        snr = "-" if r.get("snr_mean_30s") is None else f"{r['snr_mean_30s']:.1f}"
        rssi = "-" if r.get("rssi_mean_30s") is None else f"{r['rssi_mean_30s']:.0f}"
        A = "-" if r["A"] is None else f"{r['A']:.3f}"
        print(f"{T:>5}s {NODE:>10} {snr:>7} {rssi:>7} {A:>7}  {r['alert']:8s} {r['status']:7s} {top}")
        rows.append(dict(mode="SIMULATED REPLAY", t_s=T, node_id=NODE, snr_mean_30s=r.get("snr_mean_30s"),
                         rssi_mean_30s=r.get("rssi_mean_30s"), A=r["A"], alert=r["alert"], status=r["status"],
                         seconds_since_last_packet=r.get("seconds_since_last_packet"),
                         top_features=";".join(f"{x['feature']}={x['value']}" for x in r["top_features"]),
                         model=r["model"], dataset=r["dataset"]))
        if T < DURATION:
            time.sleep(10 / a.speed)
    res = pd.DataFrame(rows)
    out = RESULTS_DIR / "demo_replay.csv"
    res.to_csv(out, index=False)
    pre = res[(res.status == "OK")]
    first = {lv: pre[pre.alert.isin(["WATCH", "WARNING"] if lv == "WATCH" else ["WARNING"])].t_s.min()
             for lv in ("WATCH", "WARNING")}
    print(BANNER.splitlines()[1])
    print(f"Last packet from {NODE} at t={last_pkt:.0f} s (silence starts; counted as failure once it reaches "
          f"90 s, at t={last_pkt + 90:.0f} s{' - after the replay ends' if last_pkt + 90 > DURATION else ''}).")
    for lv in ("WATCH", "WARNING"):
        t = first[lv]
        if pd.isna(t):
            print(f"  {lv}: did NOT fire from the model before the node went silent.")
        else:
            print(f"  {lv}: first at t={t:.0f} s, {last_pkt - t:.0f} s before the last packet.")
    steady = res[res.t_s < 30]
    false_steady = steady[steady.alert != "NONE"]
    if len(false_steady):
        print(f"  FALSE ALARM: the link was still steady (t < 30 s) but the alert was "
              f"{'/'.join(sorted(false_steady.alert.unique()))} at t = {', '.join(map(str, false_steady.t_s))} s.")
    ok = (not len(false_steady) and not pd.isna(first["WATCH"]) and not pd.isna(first["WARNING"])
          and first["WATCH"] < first["WARNING"] <= last_pkt)
    print("  Result: " + ("NONE on the steady link, then WATCH, then WARNING, all before the node went silent." if ok
                          else "the intended NONE -> WATCH -> WARNING -> silence sequence did NOT happen cleanly "
                               "(see above)."))
    print(f"Wrote {out} (every row marked SIMULATED REPLAY).")


if __name__ == "__main__":
    main()
