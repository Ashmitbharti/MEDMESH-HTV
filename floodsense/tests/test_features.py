"""Leakage tests for v2 features (run: python -m pytest tests -q)."""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.features import TODAY_DISCH, TODAY_LEVEL_DERIVED, build_frame, feature_sets

THR = 1.5


def sample_frame(n=400, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2010-01-01", periods=n, freq="D")
    level = 1.3 + np.abs(np.cumsum(rng.normal(0, 0.02, n))) + (rng.random(n) < 0.03) * rng.random(n)
    df = pd.DataFrame({"LEVEL": level, "DISCHARGE": np.exp(level) * 0.1,
                       "TOTAL_PRECIPITATION": rng.gamma(0.4, 6, n), "SNOW_ON_GROUND": rng.integers(0, 10, n) * 1.0},
                      index=idx)
    df.iloc[50:55, 0] = np.nan          # a long gap stays NaN
    return df


def cols_for(target):
    sets = feature_sets(target, has_rain=True, use_snow=True)
    return sorted(set().union(*sets.values()))


@pytest.mark.parametrize("target", ["next", "same"])
@pytest.mark.parametrize("t", [40, 120, 250, 398])
def test_no_feature_at_t_uses_data_after_t(target, t):
    df = sample_frame()
    cols = cols_for(target)
    base = build_frame(df, THR, use_snow=True)[cols]
    altered = df.copy()
    rng = np.random.default_rng(1)
    altered.iloc[t + 1:] = rng.normal(5, 3, altered.iloc[t + 1:].shape)   # scramble the future
    after = build_frame(altered, THR, use_snow=True)[cols]
    pd.testing.assert_frame_equal(base.iloc[: t + 1], after.iloc[: t + 1])


@pytest.mark.parametrize("t", [40, 120, 250, 398])
def test_same_day_inputs_ignore_todays_level_and_discharge(t):
    df = sample_frame()
    cols = cols_for("same")
    base = build_frame(df, THR, use_snow=True)[cols]
    altered = df.copy()
    altered.iloc[t, altered.columns.get_loc("LEVEL")] += 2.0
    altered.iloc[t, altered.columns.get_loc("DISCHARGE")] *= 10
    after = build_frame(altered, THR, use_snow=True)[cols]
    pd.testing.assert_series_equal(base.iloc[t], after.iloc[t])


def test_same_day_feature_names_are_not_today_level_derived():
    for name, cols in feature_sets("same", has_rain=True, use_snow=True).items():
        bad = [c for c in cols if c in TODAY_LEVEL_DERIVED or c in TODAY_DISCH]
        assert not bad, f"{name} uses today-derived inputs: {bad}"


def test_next_day_label_alignment():
    from src.label import label
    df = sample_frame()
    y = label(df, "next", THR)
    i = 100
    assert y.iloc[i] == float(df["LEVEL"].iloc[i + 1] > THR)


REAL = Path(__file__).resolve().parent.parent / "data" / "clean" / "02HC013.csv"


@pytest.mark.skipif(not REAL.exists(), reason="run run_all.py first to create data/clean/02HC013.csv")
@pytest.mark.parametrize("frac", [0.3, 0.7, 0.95])
def test_real_gauge_features_ignore_later_data(frac):
    """Real Highland Creek data (with its own rain): features at day t unchanged when everything after t changes."""
    df = pd.read_csv(REAL, index_col="DATE", parse_dates=True)
    df = df[["LEVEL", "DISCHARGE", "TOTAL_PRECIPITATION"]]
    cols = sorted(set().union(*feature_sets("next", True, False).values()))
    t = int(len(df) * frac)
    base = build_frame(df, THR, use_snow=False)[cols]
    altered = df.copy()
    altered.iloc[t + 1:] = altered.iloc[t + 1:] * 3 + 7
    after = build_frame(altered, THR, use_snow=False)[cols]
    pd.testing.assert_frame_equal(base.iloc[: t + 1], after.iloc[: t + 1])
