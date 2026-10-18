"""SIMULATED coverage dataset for Model A.

python make_coverage_data.py          # ~110 rows: 11 scenarios x 10 short sessions, 1 row sampled per session
python make_coverage_data.py --big    # 20 longer multi-node sessions, every window kept (several thousand rows)

Each session is simulated as a raw packet log in collect_min.py's format (data/raw/synth_*.csv, plus
_events.csv and a _manifest.json naming the scenario per node and time range). Rows are then built from those
logs by build_dataset.py, i.e. by the same past-only feature code that real logs go through.
"""
import argparse
import json

import numpy as np
import pandas as pd

from build_dataset import build
from common import DATA_DIR, FAILURE_SCENARIOS, HARD_NEGATIVES, LABEL, RANDOM_STATE, RAW_DIR, SCENARIOS
from simulate import EVENT_NOTES, T0_BASE, make_episode, make_node, node_id, simulate_node, to_log

SESSIONS_PER_SCENARIO = 10


def write_session(session_id, t0, packets, targets, events, rng, extra=None):
    log = to_log(packets, t0, rng)
    base = RAW_DIR / f"synth_{session_id}"
    log.to_csv(f"{base}.csv", index=False)
    ev = pd.DataFrame([(pd.Timestamp(t0 + t, unit="s", tz="UTC").isoformat(timespec="milliseconds"), note)
                       for t, note in sorted(events)], columns=["ts_utc", "note"])
    ev.to_csv(f"{base}_events.csv", index=False)
    man = dict(session_id=session_id, is_simulated=True, t0=t0,
               t0_utc=pd.Timestamp(t0, unit="s", tz="UTC").isoformat(), targets=targets, **(extra or {}))
    (RAW_DIR / f"synth_{session_id}_manifest.json").write_text(json.dumps(man, indent=1))
    return f"{base}.csv"


def _ep_json(ep):
    return dict(scenario=ep["scenario"], start=ep["start"], end=ep["end"],
                event=[ep["start"] + ep["event"][0], ep["start"] + ep["event"][1]] if ep["event"] else None)


def coverage_session(sc, k, idx):
    """One short session: the scenario node, a stable anchor node and (relay_failure only) the relay."""
    rng = np.random.default_rng([RANDOM_STATE, idx])
    sid = f"cov_{sc}_{k:02d}"
    t0 = T0_BASE + idx * 3600
    tgt = make_node(rng, node_id(rng), hops=1 if sc == "relay_failure" else None)
    ep = make_episode(sc, rng, tgt, 0.0)
    T = ep["end"]
    anchor = make_node(rng, node_id(rng), hops=0)
    packets = simulate_node(tgt, [ep], T, rng)
    packets += simulate_node(anchor, [make_episode("baseline", rng, anchor, 0.0) | dict(end=T)], T, rng)
    events = [(1.0, f"SIMULATED session {sid}: scenario {sc}")]
    if ep["event"]:
        events.append((ep["event"][0], EVENT_NOTES[sc] + f" ({tgt['id']})"))
    extra = {}
    if sc == "relay_failure":
        relay = make_node(rng, node_id(rng), hops=0)
        relay["b"] = tgt["b"]
        packets += simulate_node(relay, [make_episode("baseline", rng, relay, 0.0) | dict(end=T)], T, rng,
                                 off_windows=[(ep["te"], T)])
        extra["relay"] = relay["id"]
    return write_session(sid, t0, packets, {tgt["id"]: [_ep_json(ep)]}, events, rng, extra)


def big_session(k):
    """One longer session: 3 scenario nodes, each running a chain of episodes (a failed node comes back after
    its silence), a stable anchor, and one relay per node that ever has a relay failure."""
    rng = np.random.default_rng([RANDOM_STATE, 10_000 + k])
    sid = f"big_{k:02d}"
    t0 = T0_BASE + (1000 + k) * 3600
    T = float(rng.uniform(1500, 1800))
    weights = np.array([1.0 if s in FAILURE_SCENARIOS else 0.8 for s in SCENARIOS])
    packets, targets, events, relays = [], {}, [(1.0, f"SIMULATED session {sid}")], {}
    for _ in range(3):
        node = make_node(rng, node_id(rng))
        eps, t = [], 0.0
        while t < T:
            sc = str(rng.choice(SCENARIOS, p=weights / weights.sum()))
            ep = make_episode(sc, rng, node, t)
            eps.append(ep)
            if ep["event"]:
                events.append((t + ep["event"][0], EVENT_NOTES[sc] + f" ({node['id']})"))
            t = ep["end"]
        # a node heard through a relay keeps hops=1 for its whole relay episodes; elsewhere its own hop count
        packets += simulate_node(node, eps, T, rng)
        relay_eps = [e for e in eps if e["scenario"] == "relay_failure"]
        if relay_eps:
            relay = make_node(rng, node_id(rng), hops=0)
            relay["b"] = node["b"]
            off = [(e["start"] + e["te"], e["end"]) for e in relay_eps]
            packets += simulate_node(relay, [make_episode("baseline", rng, relay, 0.0) | dict(end=T)], T, rng,
                                     off_windows=off)
            relays[node["id"]] = relay["id"]
        targets[node["id"]] = [_ep_json(e) for e in eps]
    anchor = make_node(rng, node_id(rng), hops=0)
    packets += simulate_node(anchor, [make_episode("baseline", rng, anchor, 0.0) | dict(end=T)], T, rng)
    return write_session(sid, t0, packets, targets, events, rng, dict(relays=relays))


def sample_rows(full: pd.DataFrame) -> pd.DataFrame:
    """One row per session. Failure sessions alternate positive / negative so ~half their rows are positive;
    hard-negative rows come from inside the dip / burst / walk-away 80% of the time."""
    rng = np.random.default_rng(RANDOM_STATE)
    picks = []
    for sc in SCENARIOS:
        for k in range(SESSIONS_PER_SCENARIO):
            d = full[full.session_id == f"cov_{sc}_{k:02d}"]
            if sc in FAILURE_SCENARIOS:
                want = 1 if k % 2 == 0 else 0
                pool = d[d[LABEL] == want]
                pool = pool if len(pool) else d
            elif sc in HARD_NEGATIVES and rng.random() < 0.8 and d.in_event.any():
                pool = d[d.in_event == 1]
            else:
                pool = d
            picks.append(pool.iloc[int(rng.integers(len(pool)))])
    return pd.DataFrame(picks).reset_index(drop=True)


def coverage_table(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("scenario").agg(rows=(LABEL, "size"), sessions=("session_id", "nunique"),
                                   positives=(LABEL, "sum"))
    g = g.reindex([s for s in SCENARIOS if s in g.index])
    g["kind"] = ["failure" if s in FAILURE_SCENARIOS else "hard negative" if s in HARD_NEGATIVES else "baseline"
                 for s in g.index]
    g.loc["TOTAL"] = [g.rows.sum(), df.session_id.nunique(), g.positives.sum(), ""]   # distinct sessions
    return g


def count_failure_events(df: pd.DataFrame) -> int:
    pos = df[df[LABEL] == 1]
    return int((pos.t_seconds + pos.time_to_failure_s).round(1).groupby([pos.session_id, pos.node_id])
               .nunique().sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--big", action="store_true", help="20 longer sessions, all windows kept")
    a = ap.parse_args()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    prefix = "synth_big_" if a.big else "synth_cov_"
    for f in RAW_DIR.glob(prefix + "*"):
        f.unlink()
    if a.big:
        paths = [big_session(k) for k in range(20)]
        df = build(paths)
        out = DATA_DIR / "big.csv"
    else:
        paths = [coverage_session(sc, k, i * SESSIONS_PER_SCENARIO + k)
                 for i, sc in enumerate(SCENARIOS) for k in range(SESSIONS_PER_SCENARIO)]
        full = build(paths)
        full.to_csv(DATA_DIR / "coverage_all_windows.csv", index=False)
        df = sample_rows(full)
        out = DATA_DIR / "coverage.csv"
    df.to_csv(out, index=False)
    print("SIMULATED DATA (is_simulated=1). Coverage table:")
    print(coverage_table(df).to_string())
    print(f"\n{len(df)} rows, {df.session_id.nunique()} sessions, positives {int(df[LABEL].sum())} "
          f"({df[LABEL].mean():.1%}), failure events behind the positive rows: {count_failure_events(df)}")
    print(f"raw logs: {len(paths)} x {RAW_DIR}/{prefix}*.csv (+ _events.csv, _manifest.json) -> {out}")


if __name__ == "__main__":
    main()
