"""Steps 2-4: next-day label, raw features (no engineering), chronological 70/15/15 split.

LEVEL is a gauge height above a datum (not a depth). The high-water threshold is a
percentile of LEVEL over the TRAIN period only.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import ALSO_REPORT_PCT, SPLIT_FRACS


def raw_features(has_rain: bool) -> list:
    return ["LEVEL", "DISCHARGE"] + (["TOTAL_PRECIPITATION"] if has_rain else [])


def next_level(df: pd.DataFrame) -> pd.Series:
    """LEVEL on the next CALENDAR day; NaN when that day was dropped in cleaning."""
    return df["LEVEL"].shift(-1, freq="D").reindex(df.index)


@dataclass
class Split:
    station: str
    X: dict              # split -> DataFrame
    y: dict              # split -> Series (int)
    level_today: dict    # split -> Series, for the persistence baseline
    threshold: float
    pct: float
    features: list
    neg_pos: float


def build(station: str, df: pd.DataFrame, has_rain: bool, pct: float) -> Split:
    feats = raw_features(has_rain)
    df = df.dropna(subset=["LEVEL", "DISCHARGE"])   # v1 uses only days with both readings
    nxt = next_level(df)
    data = df.loc[nxt.notna(), feats].copy()
    data["next_level"] = nxt[nxt.notna()]
    n = len(data)
    i_tr, i_va = int(round(n * SPLIT_FRACS[0])), int(round(n * (SPLIT_FRACS[0] + SPLIT_FRACS[1])))
    parts = {"train": data.iloc[:i_tr], "val": data.iloc[i_tr:i_va], "test": data.iloc[i_va:]}

    thr = float(np.percentile(parts["train"]["LEVEL"], pct))
    X, y, lv = {}, {}, {}
    for k, p in parts.items():
        X[k] = p[feats]
        y[k] = (p["next_level"] > thr).astype(int)
        lv[k] = p["LEVEL"]
    neg_pos = float((y["train"] == 0).sum() / max(y["train"].sum(), 1))
    return Split(station, X, y, lv, thr, pct, feats, neg_pos)


def print_split(sp: Split, df: pd.DataFrame):
    print(f"  [{sp.station}] features: {sp.features}")
    print(f"    high-water threshold: LEVEL > {sp.threshold:.3f} m above gauge datum (train p{sp.pct:g})")
    alt = float(np.percentile(sp.X['train']['LEVEL'], ALSO_REPORT_PCT))
    for k in ("train", "val", "test"):
        y = sp.y[k]
        alt_pos = int((next_level(df).loc[y.index] > alt).sum())
        print(f"    {k:<5} {y.index.min().date()} -> {y.index.max().date()}  n={len(y):5d}  "
              f"positives={int(y.sum()):4d} ({100 * y.mean():.2f}%)  | at p{ALSO_REPORT_PCT} "
              f"(> {alt:.3f}): {alt_pos} ({100 * alt_pos / len(y):.2f}%)")
        if k != "train" and y.sum() < 10:
            print(f"    !!!!! WARNING: {k} has only {int(y.sum())} positive days (<10); "
                  f"its metrics are very noisy !!!!!")
