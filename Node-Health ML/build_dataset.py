"""Raw packet logs (collect_min.py format) -> one row per 10 s window per node.

python build_dataset.py data/raw/synth_*.csv --out data/from_raw.csv
python build_dataset.py data/raw/walkout_01.csv --out data/real.csv       # real logger output

A `{session}_manifest.json` next to a log (written for simulated logs) says which nodes to make rows for and
which scenario each time range belongs to. Without one, every node gets rows with scenario "real".
"""
import argparse
import glob
import json
from pathlib import Path

import numpy as np
import pandas as pd

from common import (FEATURES, ID_COLS, LABEL, failures, label_at, node_arrays, node_features_at, read_log,
                    window_times)

SKIP_SUFFIXES = ("_events.csv", "_nodes.csv", "_acks.csv")


def _episode(eps, t_rel):
    for e in eps:
        if e["start"] <= t_rel < e["end"]:
            return e
    return eps[-1] if t_rel >= eps[-1]["end"] else eps[0]


def build_session(path) -> pd.DataFrame:
    path = Path(path)
    log = read_log(path)
    man_path = path.with_name(path.stem + "_manifest.json")
    man = json.loads(man_path.read_text()) if man_path.exists() else None
    session = man["session_id"] if man else path.stem
    log_start = man["t0"] if man else float(log["t"].min())
    log_end = float(log["t"].max())
    targets = man["targets"] if man else {n: [{"scenario": "real", "start": 0, "end": np.inf, "event": None}]
                                          for n in log["from_id"].dropna().unique()}
    rows = []
    for node, eps in targets.items():
        a = node_arrays(log, node)
        if not len(a["ts"]):
            continue
        fails = failures(a["ts"], log_end)
        for t in window_times(a["ts"][0], log_start, log_end):
            lab = label_at(t, fails, log_end)
            if lab is None:
                continue
            y, ttf = lab
            t_rel = t - log_start
            # a positive row belongs to the scenario whose failure it precedes
            ep = _episode(eps, t_rel + ttf if y == 1 else t_rel)
            ev = ep.get("event")
            rows.append(dict(scenario=ep["scenario"], session_id=session, node_id=node, t_seconds=round(t_rel, 3),
                             **node_features_at(a, t), **{LABEL: y}, time_to_failure_s=ttf,
                             in_event=int(bool(ev) and ev[0] <= t_rel <= ev[1] + 10),
                             is_simulated=int(bool(man and man.get("is_simulated")))))
    cols = ID_COLS + FEATURES + [LABEL, "snr_max_30s", "time_to_failure_s", "in_event", "is_simulated"]
    return pd.DataFrame(rows, columns=cols)


def build(paths) -> pd.DataFrame:
    paths = [p for p in paths if not str(p).endswith(SKIP_SUFFIXES)]
    return pd.concat([build_session(p) for p in sorted(paths)], ignore_index=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", nargs="+", help="collect_min.py CSVs (globs ok)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    paths = [p for g in a.logs for p in glob.glob(g)]
    df = build(paths)
    df.to_csv(a.out, index=False)
    n_logs = len([p for p in paths if not str(p).endswith(SKIP_SUFFIXES)])
    print(f"{len(df)} rows from {n_logs} logs, {int(df[LABEL].sum())} positives -> {a.out}")


if __name__ == "__main__":
    main()
