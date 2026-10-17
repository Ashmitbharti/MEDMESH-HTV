"""Demo inference for the MedMesh combiner.

python predict.py --station 02HC033 [--csv realtime.csv] [--rain-today MM --rain-3d MM --rain-7d MM]
python predict.py --station 02HC033 --multiclass ...    # experimental NORMAL/ELEVATED/HIGH output
python predict.py --station 02HC033 --v1 [--rain MM]    # old v1 binary (raw features) output

Default (binary v2, NEXT-DAY, p95): builds the LEAN features for the last COMPLETE local day in the realtime
file from daily MEAN level/discharge (what the models were trained on) and prints P(LEVEL tomorrow > train p95)
plus a YES/NO high-water flag at the cut-off chosen on validation (max F2). The realtime file has no rain:
pass Pearson totals with --rain-*; missing rain is filled by the train-fitted median imputer (i.e. treated as
a typical, mostly dry day).
"""
import argparse
import warnings

import joblib
import numpy as np
import pandas as pd

from src.clean import load_realtime, realtime_daily
from src.config import MODELS_DIR, STATIONS
from src.features import build_frame

warnings.filterwarnings("ignore", category=UserWarning, message=".*feature names.*")


def latest_complete(daily):
    full = daily[daily["complete"]]
    if full.empty:
        raise SystemExit("No complete day (>= 80% of 5-minute samples) in the realtime file.")
    return full


def lean_row(a, thr, features):
    """LEAN features for the last complete realtime day (daily means), with rain from the CLI."""
    full = latest_complete(realtime_daily(load_realtime(a.station, a.csv)))
    cal = pd.date_range(full.index.min(), full.index.max(), freq="D")
    frame = pd.DataFrame({"LEVEL": full["LEVEL_mean"], "DISCHARGE": full["DISCHARGE_mean"]}).reindex(cal)
    frame["TOTAL_PRECIPITATION"] = np.nan
    day = cal[-1]
    row = build_frame(frame, thr, use_snow=False).loc[[day]].copy()
    rain = {"rain_today": a.rain_today, "rain_sum_3d": a.rain_3d, "rain_sum_7d": a.rain_7d}
    for k, v in rain.items():
        row[k] = np.nan if v is None else v
    X = row[features]
    print(f"  today ({day.date()} LST): LEVEL daily mean {frame.loc[day, 'LEVEL']:.3f} m, DISCHARGE daily mean "
          f"{frame.loc[day, 'DISCHARGE']:.3f} m3/s; {int(frame['LEVEL'].notna().sum())} complete days of history")
    missing = [k for k, v in rain.items() if v is None]
    if missing:
        print(f"  !!! rain not supplied ({', '.join(missing)}): imputed with the train median (a typical, mostly "
              f"dry day). Pass --rain-today/--rain-3d/--rain-7d for a real forecast. !!!")
    na = [c for c in features if pd.isna(X.iloc[0][c]) and c not in rain]
    if na:
        print(f"  note: imputed (not enough realtime history): {na}")
    return X, day


def predict_binary(a):
    b = joblib.load(MODELS_DIR / "v2" / f"best_{a.station}_next_p95.joblib")
    print(f"station {a.station} | binary v2 model {b['model']} ({b['feature_set']}, NEXT-DAY, p{b['pct']:g})")
    X, day = lean_row(a, b["level_threshold"], b["features"])
    p = float(b["pipeline"].predict_proba(X)[0, 1])
    print(f"  high water = LEVEL tomorrow ({(day + pd.Timedelta(days=1)).date()}) > {b['level_threshold']:.3f} m "
          f"above gauge datum (train p{b['pct']:g}); decision cut-off {b['cutoff']:.4f} (max F2 on validation)")
    print(f"  risk probability (high water tomorrow): {p:.4f}")
    print(f"  FLAG: {'YES' if p >= b['cutoff'] else 'NO'}")


def predict_multiclass(a):
    from src.multiclass import LEVELS, apply_rule, proba3
    b = joblib.load(MODELS_DIR / "multiclass" / f"best_{a.station}.joblib")
    print(f"station {a.station} | multiclass model {b['candidate']} (experimental)")
    X, day = lean_row(a, b["p95"], b["features"])
    P = proba3(b, X)
    lvl_argmax = LEVELS[int(apply_rule(P, "argmax")[0])]
    lvl_safety = LEVELS[int(apply_rule(P, "safety", b["t1"], b["t2"])[0])]
    print(f"  forecast for {(day + pd.Timedelta(days=1)).date()}; classes: NORMAL <= {b['p90']:.3f} m < ELEVATED <= {b['p95']:.3f} m < HIGH (train p90 / p95)")
    print(f"  P(NORMAL)={P[0, 0]:.4f}  P(ELEVATED)={P[0, 1]:.4f}  P(HIGH)={P[0, 2]:.4f}")
    print(f"  LEVEL (highest probability):  {lvl_argmax}")
    print(f"  LEVEL (safety rule, HIGH if P(HIGH) >= {b['t2']:.3f}, ELEVATED if P(ELEVATED)+P(HIGH) >= "
          f"{b['t1']:.3f}): {lvl_safety}")


def predict_v1(a):
    b = joblib.load(MODELS_DIR / f"best_{a.station}.joblib")
    r = latest_complete(realtime_daily(load_realtime(a.station, a.csv)))
    day = r.index.max()
    r = r.loc[day]
    row = {"LEVEL": r["LEVEL_max"], "DISCHARGE": r["DISCHARGE_mean"]}
    if b["has_rain"]:
        row["TOTAL_PRECIPITATION"] = np.nan if a.rain is None else a.rain
    X = pd.DataFrame([row])[b["features"]]
    p = float(b["pipeline"].predict_proba(X)[0, 1])
    p_mean = float(b["pipeline"].predict_proba(X.assign(LEVEL=r["LEVEL_mean"]))[0, 1])
    print(f"station {a.station} | v1 model {b['model']} | day {day.date()} (LST, {int(r['n_samples'])} samples)")
    print(f"  inputs: LEVEL daily max {r['LEVEL_max']:.3f} m (daily mean {r['LEVEL_mean']:.3f}), "
          f"DISCHARGE daily mean {r['DISCHARGE_mean']:.3f} m3/s")
    print(f"  high-water threshold {b['level_threshold']:.3f} m (train p{b['pct']:g}), cut-off {b['cutoff']:.4f}")
    print(f"  risk probability (high water tomorrow): {p:.4f}  FLAG: {'YES' if p >= b['cutoff'] else 'NO'}")
    print(f"  [check] same model fed the daily MEAN level instead: {p_mean:.4f} -> "
          f"{'YES' if p_mean >= b['cutoff'] else 'NO'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--station", required=True, choices=list(STATIONS))
    ap.add_argument("--csv", default=None, help="realtime csv (default: the station's realtime file)")
    ap.add_argument("--rain-today", type=float, default=None, help="Pearson total precipitation today, mm")
    ap.add_argument("--rain-3d", type=float, default=None, help="sum of the last 3 days incl. today, mm")
    ap.add_argument("--rain-7d", type=float, default=None, help="sum of the last 7 days incl. today, mm")
    ap.add_argument("--multiclass", action="store_true", help="experimental NORMAL/ELEVATED/HIGH model instead")
    ap.add_argument("--v1", action="store_true", help="use the v1 raw-features binary model instead")
    ap.add_argument("--rain", type=float, default=None, help="v1 only: today's precipitation, mm")
    a = ap.parse_args()
    if a.v1:
        predict_v1(a)
    elif a.multiclass:
        predict_multiclass(a)
    else:
        predict_binary(a)


if __name__ == "__main__":
    main()
