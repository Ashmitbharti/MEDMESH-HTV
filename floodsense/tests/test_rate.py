"""Leakage tests for the Model B RATE features (hourly-derived and daily drainage proxies)."""
import numpy as np
import pandas as pd
import pytest

from src.rate import hourly_to_daily, rate_features

STATS = dict(thr=1.6, train_median_level=1.35, capacity=4.0, median_train_ant7=12.0, rate_var="max_1h_rain")


def sample_frame(days=200, seed=0):
    rng = np.random.default_rng(seed)
    hours = pd.date_range("2015-01-01", periods=days * 24, freq="h")
    h = pd.Series(np.where(rng.random(len(hours)) < 0.06, rng.gamma(0.7, 3, len(hours)), 0.0), index=hours)
    h.iloc[500:540] = np.nan                                   # a gap in the hourly record
    idx = pd.date_range("2015-01-01", periods=days, freq="D")
    level = 1.3 + np.abs(np.cumsum(rng.normal(0, 0.02, days)))
    df = pd.DataFrame({"LEVEL": level, "DISCHARGE": np.exp(level) * 0.2,
                       "TOTAL_PRECIPITATION": h.resample("D").sum(min_count=1).to_numpy()}, index=idx)
    return h, df


def all_features(h, df):
    return rate_features(df, hourly_to_daily(h), STATS)


@pytest.mark.parametrize("t", [20, 90, 150, 198])
def test_hourly_and_drainage_features_ignore_later_data(t):
    h, df = sample_frame()
    base = all_features(h, df)
    cut = df.index[t] + pd.Timedelta(hours=23)                 # end of day t
    h2, df2 = h.copy(), df.copy()
    h2[h2.index > cut] = 50.0                                  # scramble every later hour
    df2.iloc[t + 1:] = df2.iloc[t + 1:] * 3 + 9                # and every later day
    after = all_features(h2, df2)
    pd.testing.assert_frame_equal(base.iloc[: t + 1], after.iloc[: t + 1])


def test_day_needs_20_hours_and_ratio_definition():
    h, _ = sample_frame()
    d = hourly_to_daily(h)
    gap_day = h.index[520].floor("D")
    assert d.loc[gap_day].isna().all()
    ok = d.dropna().iloc[5]
    assert ok["intensity_ratio"] == pytest.approx(ok["max_1h_rain"] / (ok["rain_total_day"] + 0.1))


def test_antecedent_excludes_today():
    _, df = sample_frame()
    f = rate_features(df, None, {**STATS, "rate_var": "rain_today"})
    t = 50
    assert f["antecedent_7d"].iloc[t] == pytest.approx(df["TOTAL_PRECIPITATION"].iloc[t - 7:t].sum())
