"""Model B step 2: RAIN-RATE vs DRAINAGE features ("RATE"). Everything at row t uses data up to day t only.

Intensity (from hourly rain at the gauge's hourly station, aggregated per local day; a day needs >= 20 of
24 hours reported, else NaN):
  max_1h_rain, max_3h_rain (3-hour sums ending inside day t; the first two windows reach back into t-1),
  hours_with_rain, rain_total_day, intensity_ratio = max_1h_rain / (rain_total_day + 0.1)
Drainage proxies (daily, past only; these are physics-motivated proxies, NOT measured drainage):
  antecedent_7d / antecedent_14d : daily rain summed over the previous 7 / 14 days (today excluded)
  recession  : median of Q(t)/Q(t-1) over the previous 7 days, falling-limb days only (Q dropped)
  disch_chg_3d : Q(t) - Q(t-3)
  headroom   : (threshold - LEVEL(t)) / (threshold - train median LEVEL), clipped to [-1, 2]
Net features (only if a capacity could be estimated on TRAIN):
  rate = max_1h_rain, or the daily rain total when the gauge has no hourly rain
  rain_minus_drain = rate - capacity ; rain_over_drain = rate / capacity
  saturation_adjusted_rain = rate * (1 + antecedent_7d / (median train antecedent_7d + 1))
"""
import numpy as np
import pandas as pd

INTENSITY = ["max_1h_rain", "max_3h_rain", "hours_with_rain", "rain_total_day", "intensity_ratio"]
DRAINAGE = ["antecedent_7d", "antecedent_14d", "recession", "disch_chg_3d", "headroom"]
NET = ["rain_minus_drain", "rain_over_drain", "saturation_adjusted_rain"]
MIN_HOURS = 20
CAP_RATE = 0.30
CAP_MIN_DAYS, CAP_MIN_POS = 15, 5
CAP_QUANTILES = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.975, 1.0]


def hourly_to_daily(h: pd.Series) -> pd.DataFrame:
    """Hourly precipitation (local standard time index) -> one row of intensity features per local day."""
    if h is None or h.dropna().empty:
        return pd.DataFrame(columns=INTENSITY)
    start, end = h.index.min().floor("D"), h.index.max().floor("D") + pd.Timedelta(hours=23)
    full = h.reindex(pd.date_range(start, end, freq="h"))
    day = full.index.floor("D")
    n = full.notna().groupby(day).sum()
    r3 = full.rolling(3, min_periods=3).sum()
    out = pd.DataFrame({
        "max_1h_rain": full.groupby(day).max(),
        "max_3h_rain": r3.groupby(day).max(),
        "hours_with_rain": (full > 0).groupby(day).sum().astype(float),
        "rain_total_day": full.groupby(day).sum(min_count=1),
    })
    out[n < MIN_HOURS] = np.nan
    out["intensity_ratio"] = out["max_1h_rain"] / (out["rain_total_day"] + 0.1)
    out.index.name = "DATE"
    return out[INTENSITY]


def drainage(df: pd.DataFrame, thr: float, train_median_level: float) -> pd.DataFrame:
    P, Q, L = df["TOTAL_PRECIPITATION"].astype(float), df["DISCHARGE"].astype(float), df["LEVEL"].astype(float)
    ratio = Q / Q.shift(1)
    falling = Q < Q.shift(1)
    denom = thr - train_median_level
    return pd.DataFrame({
        "antecedent_7d": P.shift(1).rolling(7, min_periods=7).sum(),
        "antecedent_14d": P.shift(1).rolling(14, min_periods=14).sum(),
        "recession": ratio.where(falling).shift(1).rolling(7, min_periods=2).median(),
        "disch_chg_3d": Q - Q.shift(3),
        "headroom": ((thr - L) / denom).clip(-1, 2) if denom > 0 else np.nan,
    }, index=df.index)


def rate_features(df: pd.DataFrame, hourly_daily, stats: dict) -> pd.DataFrame:
    """All new columns on df's calendar index. stats: thr, train_median_level, capacity (or None),
    median_train_ant7, rate_var ('max_1h_rain' or 'rain_today')."""
    out = drainage(df, stats["thr"], stats["train_median_level"])
    if hourly_daily is not None:
        out = out.join(hourly_daily.reindex(df.index))
    rate = out["max_1h_rain"] if stats["rate_var"] == "max_1h_rain" else df["TOTAL_PRECIPITATION"].astype(float)
    cap = stats.get("capacity")
    if cap:
        out["rain_minus_drain"] = rate - cap
        out["rain_over_drain"] = rate / cap
        out["saturation_adjusted_rain"] = rate * (1 + out["antecedent_7d"] / (stats["median_train_ant7"] + 1))
    return out


def estimate_capacity(rate: pd.Series, y_next: pd.Series):
    """TRAIN rows only. Bin rain days (rate > 0) by quantiles; the capacity is the lower edge of the first
    bin (ascending) whose next-day high-water rate exceeds 0.30, with >= 15 days and >= 5 positives.
    Returns (capacity or None, table, reason)."""
    d = pd.DataFrame({"rate": rate, "y": y_next}).dropna()
    d = d[d["rate"] > 0]
    if d["y"].sum() < CAP_MIN_POS or len(d) < 50:
        return None, None, f"too few rain days ({len(d)}) or events ({int(d['y'].sum())}) in train"
    edges = np.unique(np.quantile(d["rate"], CAP_QUANTILES))
    d["bin"] = pd.cut(d["rate"], edges, include_lowest=True)
    tab = d.groupby("bin", observed=True).agg(lower=("rate", "min"), upper=("rate", "max"), days=("y", "size"),
                                              positives=("y", "sum"), rate_next_day_high=("y", "mean"))
    for _, r in tab.iterrows():
        if r["rate_next_day_high"] > CAP_RATE and r["days"] >= CAP_MIN_DAYS and r["positives"] >= CAP_MIN_POS:
            return float(r["lower"]), tab, "ok"
    top = tab.iloc[-1]
    return None, tab, (f"no bin reached a next-day high-water rate > {CAP_RATE} with >= {CAP_MIN_DAYS} days and "
                       f">= {CAP_MIN_POS} events (top bin: {top['rate_next_day_high']:.2f} on {int(top['days'])} days)")
