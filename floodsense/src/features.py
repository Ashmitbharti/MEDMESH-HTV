"""v2 features. Every feature at row t uses only data from days <= t.

Hydro features are built "as of day t". The SAME-DAY (nowcast) target may not see today's
LEVEL or anything derived from it, so it uses the same hydro features shifted one day
(suffix `_y1` = as of yesterday) plus today's rain and calendar.

The input frame must be on a full daily calendar (one row per day) so shift(k) = k days.
"""
import numpy as np
import pandas as pd

DAYS_SINCE_CAP = 365
SNOW_MIN_COVERAGE = 0.80     # SNOW_ON_GROUND must cover >= 80% of days in train AND in val+test to be used


def _mp(w):
    return max(2, int(np.ceil(0.8 * w)))


def days_since(mask: pd.Series, cap: int = DAYS_SINCE_CAP) -> pd.Series:
    """Days since the last True at or before t (0 if today), capped. NaN counts as False."""
    m = mask.fillna(False).to_numpy(bool)
    out, last = np.empty(len(m)), None
    for i, flag in enumerate(m):
        if flag:
            last = i
        out[i] = cap if last is None else min(i - last, cap)
    return pd.Series(out, index=mask.index)


def hydro_features(df: pd.DataFrame, thr: float) -> pd.DataFrame:
    """Level/discharge features as of day t. `thr` (train-fitted) is only used by days_since_high."""
    L, D = df["LEVEL"].astype(float), df["DISCHARGE"].astype(float)
    f = {"level": L, "disch": D}
    c1 = L - L.shift(1)
    f["level_chg_1d"] = c1
    f["level_chg_3d"] = L - L.shift(3)
    f["disch_chg_1d"] = D - D.shift(1)
    f["level_accel"] = c1 - c1.shift(1)
    f["level_max_3d"] = L.rolling(3, min_periods=3).max()
    f["level_max_7d"] = L.rolling(7, min_periods=_mp(7)).max()
    past = L.shift(1).rolling(30, min_periods=_mp(30))          # the 30 days BEFORE t
    f["level_z30"] = (L - past.mean()) / past.std().replace(0, np.nan)
    # BIG-only extras
    for k in (1, 2, 3, 7):
        f[f"level_lag{k}"] = L.shift(k)
        f[f"disch_lag{k}"] = D.shift(k)
    for w in (7, 14, 30):
        f[f"level_rmean{w}"] = L.rolling(w, min_periods=_mp(w)).mean()
        f[f"level_rstd{w}"] = L.rolling(w, min_periods=_mp(w)).std()
        f[f"disch_rmean{w}"] = D.rolling(w, min_periods=_mp(w)).mean()
        f[f"disch_rstd{w}"] = D.rolling(w, min_periods=_mp(w)).std()
    f["disch_level_ratio"] = D / L
    f["days_since_high"] = days_since(L > thr)
    return pd.DataFrame(f, index=df.index)


def weather_features(df: pd.DataFrame, use_snow: bool) -> pd.DataFrame:
    f = {}
    if "TOTAL_PRECIPITATION" in df:
        P = df["TOTAL_PRECIPITATION"].astype(float)
        f["rain_today"] = P
        f["rain_sum_3d"] = P.rolling(3, min_periods=3).sum()
        f["rain_sum_7d"] = P.rolling(7, min_periods=7).sum()
    m = df.index.month
    f["month_sin"] = np.sin(2 * np.pi * m / 12)
    f["month_cos"] = np.cos(2 * np.pi * m / 12)
    if use_snow:
        f["snow_on_ground"] = df["SNOW_ON_GROUND"].astype(float)
    return pd.DataFrame(f, index=df.index)


def build_frame(df: pd.DataFrame, thr: float, use_snow: bool) -> pd.DataFrame:
    """All candidate columns: hydro as of t, hydro as of t-1 (`_y1`), weather/calendar as of t."""
    if not df.index.is_monotonic_increasing or df.index.has_duplicates or \
            (len(df) > 1 and (df.index[1:] - df.index[:-1] != pd.Timedelta(days=1)).any()):
        raise ValueError("expected a full, sorted daily calendar index")
    H = hydro_features(df, thr)
    H1 = H.shift(1).add_suffix("_y1")
    return pd.concat([H, H1, weather_features(df, use_snow)], axis=1)


RAIN = ["rain_today", "rain_sum_3d", "rain_sum_7d"]
CAL = ["month_sin", "month_cos"]
BIG_EXTRA = ([f"{v}_lag{k}" for k in (1, 2, 3, 7) for v in ("level", "disch")]
             + [f"{v}_r{s}{w}" for w in (7, 14, 30) for v in ("level", "disch") for s in ("mean", "std")]
             + ["disch_level_ratio", "days_since_high"])
# Columns derived from today's LEVEL: forbidden for the SAME-DAY target.
TODAY_LEVEL_DERIVED = {"level", "level_chg_1d", "level_chg_3d", "level_accel", "level_max_3d", "level_max_7d",
                       "level_z30", "disch_level_ratio", "days_since_high", "level_lag0"}
# Today's discharge is computed from today's stage via the rating curve, so it is excluded too.
TODAY_DISCH = {"disch", "disch_chg_1d"}


def feature_sets(target: str, has_rain: bool, use_snow: bool) -> dict:
    rain = RAIN if has_rain else []
    snow = ["snow_on_ground"] if use_snow else []
    if target == "next":
        lean_hydro = ["level", "disch", "level_chg_1d", "level_chg_3d", "disch_chg_1d", "level_accel",
                      "level_max_3d", "level_max_7d", "level_z30"]
        sets = {"LEVEL_ONLY": ["level", "level_chg_1d", "level_chg_3d"],
                "LEAN": lean_hydro + rain + CAL + snow}
        sets["BIG"] = sets["LEAN"] + BIG_EXTRA
    elif target == "same":
        lean_hydro = ["level_y1", "level_chg_1d_y1", "disch_y1", "disch_chg_1d_y1"]
        sets = {"LEVEL_ONLY": ["level_y1", "level_chg_1d_y1", "level_chg_3d_y1"],
                "LEAN": lean_hydro + rain + CAL + snow}
        other = ["level_chg_3d", "level_accel", "level_max_3d", "level_max_7d", "level_z30"] + BIG_EXTRA
        sets["BIG"] = sets["LEAN"] + [f"{c}_y1" for c in other]
    else:
        raise ValueError(target)
    sets["LEAN_NO_RAIN"] = [c for c in sets["LEAN"] if c not in RAIN]
    return sets


def drop_constant(cols, X_train: pd.DataFrame):
    keep = [c for c in cols if X_train[c].nunique(dropna=True) > 1]
    return keep, [c for c in cols if c not in keep]


def snow_usable(df: pd.DataFrame, train_end) -> tuple[bool, str]:
    if "SNOW_ON_GROUND" not in df:
        return False, "SNOW_ON_GROUND column absent"
    s = df["SNOW_ON_GROUND"]
    tr, rest = s.loc[:train_end].notna().mean(), s.loc[train_end:].iloc[1:].notna().mean()
    ok = tr >= SNOW_MIN_COVERAGE and rest >= SNOW_MIN_COVERAGE
    return ok, f"SNOW_ON_GROUND coverage train {100 * tr:.0f}%, val+test {100 * rest:.0f}% " \
               f"(need >= {100 * SNOW_MIN_COVERAGE:.0f}% in both)"
