"""Today's features and probability for a gauge from its realtime file (shared by predict_all.py,
src/combine.py and floodrisk.py), with an optional what-if simulation.

Features are built with the SAME code as training: build_frame (LEAN) + rate_features (intensity, drainage
proxies, net features) on a daily calendar of realtime daily MEANS (complete local days only), with daily
rain from the gauge's climate station and, if the gauge has one, hourly rain (src/live_rain.py).
If the daily rain for the latest day is not published yet but the gauge's hourly station IS its daily
station, the day's hourly total is used for it. Anything still missing is imputed by the model's train
median and listed in `imputed`.

Simulation (--simulate STATION=PCT): the latest day's LEVEL and DISCHARGE are set to the PCT-th percentile
of the gauge's TRAINING period (read from data/clean/{station}.csv) on an in-memory copy. No file is written.
"""
import contextlib
import io

import joblib
import numpy as np
import pandas as pd

from .clean import load_realtime, realtime_daily
from .combine import alert_level
from .config import CLEAN_DIR, MODELS_DIR
from .features import build_frame
from .live_rain import recent
from .rate import hourly_to_daily, rate_features

RAIN_FEATURES = {"rain_today", "rain_sum_3d", "rain_sum_7d", "antecedent_7d", "antecedent_14d", "max_1h_rain",
                 "max_3h_rain", "hours_with_rain", "rain_total_day", "intensity_ratio", "rain_minus_drain",
                 "rain_over_drain", "saturation_adjusted_rain"}


def parse_simulate(items):
    """['02HC058=99', '02HC013=98'] -> {'02HC058': 99.0, '02HC013': 98.0}"""
    out = {}
    for it in items or []:
        if "=" not in it:
            raise SystemExit(f"--simulate expects STATION=PERCENTILE, got {it!r}")
        st, pct = it.split("=", 1)
        pct = float(pct)
        if not 0 <= pct <= 100:
            raise SystemExit(f"--simulate percentile must be 0-100, got {pct} for {st}")
        if not (MODELS_DIR / f"{st}.joblib").exists():
            raise SystemExit(f"--simulate: no model for {st} (models/{st}.joblib)")
        out[st] = pct
    return out


def train_percentiles(station, pct, bundle):
    """PCT-th percentile of LEVEL and DISCHARGE over the gauge's training period (read-only)."""
    df = pd.read_csv(CLEAN_DIR / f"{station}.csv", index_col="DATE", parse_dates=True)
    tr = df.loc[: pd.Timestamp(bundle["split_dates"][0])]
    return float(np.nanpercentile(tr["LEVEL"], pct)), float(np.nanpercentile(tr["DISCHARGE"], pct))


def feature_row(station, bundle, override=None, offline=False, path=None):
    rt = load_realtime(station, path)
    daily = realtime_daily(rt)
    full = daily[daily["complete"]]
    if full.empty:
        raise ValueError("no complete day in the realtime file")
    cal = pd.date_range(full.index.min(), full.index.max(), freq="D")
    day = cal[-1]
    frame = pd.DataFrame({"LEVEL": full["LEVEL_mean"], "DISCHARGE": full["DISCHARGE_mean"]}).reindex(cal)
    real = (float(frame.loc[day, "LEVEL"]), float(frame.loc[day, "DISCHARGE"]))
    if override:
        frame = frame.copy()
        for k, v in override.items():
            frame.loc[day, k] = v

    rain_d, st_d = recent("daily", bundle["rain_station"], day, offline=offline)
    frame["TOTAL_PRECIPITATION"] = rain_d.reindex(cal) if rain_d is not None else np.nan
    hd, st_h = None, "n/a (no hourly station)"
    if bundle.get("hourly_station"):
        rain_h, st_h = recent("hourly", bundle["hourly_station"], day, offline=offline)
        if rain_h is not None:
            hd = hourly_to_daily(rain_h)
            if bundle["hourly_station"] == bundle["rain_station"]:
                fill = frame["TOTAL_PRECIPITATION"].isna()
                frame.loc[fill, "TOTAL_PRECIPITATION"] = hd["rain_total_day"].reindex(cal)[fill]
    F = build_frame(frame, bundle["level_threshold"], use_snow=False)
    if bundle.get("stats"):
        F = F.join(rate_features(frame, hd, bundle["stats"]))
    X = F.loc[[day]].reindex(columns=bundle["features"])
    imputed = [c for c in bundle["features"] if pd.isna(X.iloc[0][c])]
    latest_utc = (rt.index.max() + pd.Timedelta(hours=5)).tz_localize("UTC")   # LST is a fixed UTC-5
    return X, dict(features_day=str(day.date()), latest_reading_utc=latest_utc.isoformat(),
                   level_mean=float(frame.loc[day, "LEVEL"]), discharge_mean=float(frame.loc[day, "DISCHARGE"]),
                   real_level_mean=real[0], real_discharge_mean=real[1],
                   history_days=int(frame["LEVEL"].notna().sum()), daily_rain=st_d, hourly_rain=st_h,
                   imputed=imputed, imputed_rain=[c for c in imputed if c in RAIN_FEATURES])


def predict_gauge(station, simulate_pct=None, offline=False):
    """Probability + alert level for one gauge. simulate_pct: optional training percentile for a what-if."""
    b = joblib.load(MODELS_DIR / f"{station}.joblib")
    override, sim = None, None
    if simulate_pct is not None:
        lv, dq = train_percentiles(station, simulate_pct, b)
        override = {"LEVEL": lv, "DISCHARGE": dq}
        sim = dict(percentile=simulate_pct, level=lv, discharge=dq)
    with contextlib.redirect_stdout(io.StringIO()):
        X, info = feature_row(station, b, override, offline)
    p = float(b["pipeline"].predict_proba(X)[0, 1])
    return dict(p=p, time=info["latest_reading_utc"], level=alert_level(p, b["watch"], b["warning"]),
                features_day=info["features_day"], simulated=sim is not None, simulation=sim, info=info,
                model=b["model"], feature_set=b.get("feature_set", "LEAN"), watch=b["watch"], warning=b["warning"])
