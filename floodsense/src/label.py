"""v2 labels. LEVEL is a gauge height above a datum (not a depth); thresholds come from TRAIN only.

NEXT-DAY: y[t] = 1 if LEVEL[t+1] > thr  (forecast issued at the end of day t)
SAME-DAY: y[t] = 1 if LEVEL[t]   > thr  (nowcast; may not use today's LEVEL as input)
"""
import numpy as np
import pandas as pd

from .config import SPLIT_FRACS


def threshold(level_train: pd.Series, pct: float) -> float:
    vals = level_train.dropna().to_numpy()
    if len(vals) == 0:
        raise SystemExit("No LEVEL values in the train period; cannot set a threshold.")
    return float(np.percentile(vals, pct))


def target_level(df: pd.DataFrame, target: str) -> pd.Series:
    """The LEVEL the label looks at, aligned to row t (calendar frame)."""
    if target == "next":
        return df["LEVEL"].shift(-1)
    if target == "same":
        return df["LEVEL"]
    raise ValueError(target)


def label(df: pd.DataFrame, target: str, thr: float) -> pd.Series:
    lv = target_level(df, target)
    y = (lv > thr).astype(float)
    y[lv.isna()] = np.nan
    return y


def usable_rows(df: pd.DataFrame, target: str) -> pd.Series:
    """Rows with the readings each target cannot do without (never filled across long gaps)."""
    L, D = df["LEVEL"], df["DISCHARGE"]
    if target == "next":
        return L.notna() & D.notna() & L.shift(-1).notna()
    return L.notna() & L.shift(1).notna() & D.shift(1).notna()


def split_dates(df: pd.DataFrame):
    """Same chronological 70/15/15 split as v1: by count over days with LEVEL, DISCHARGE and next-day LEVEL.
    Both targets use these boundary dates."""
    d = df.index[usable_rows(df, "next")]
    n = len(d)
    i_tr, i_va = int(round(n * SPLIT_FRACS[0])), int(round(n * (SPLIT_FRACS[0] + SPLIT_FRACS[1])))
    return d[i_tr - 1], d[i_va - 1]


def persistence(df: pd.DataFrame, target: str, thr: float) -> pd.Series:
    """NEXT-DAY: high tomorrow if high today. SAME-DAY: high today if high yesterday."""
    lv = df["LEVEL"] if target == "next" else df["LEVEL"].shift(1)
    return (lv > thr).astype(float)
