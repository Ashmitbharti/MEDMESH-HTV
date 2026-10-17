"""Model B: latest high-water probability and NONE/WATCH/WARNING for every gauge with a model + realtime file.

python predict_all.py                                   # fetches recent rain (daily + hourly) from ECCC GeoMet
python predict_all.py --offline                         # no network: cached rain in data/rain_live/, else imputed
python predict_all.py --simulate 02HC058=99 02HC013=98  # what-if, see src/live.py
python predict_all.py --stations 02HC013,02HC058 --out some/other.json

Features are built from the last complete local day of each gauge's realtime CSV (daily means) with the
SAME feature code as training, using hourly rain where the gauge has an hourly station, else daily rain only.
Writes results/latest_readings.json (read by `python -m src.combine` and floodrisk.risk_at); with
--simulate it writes results/simulated_readings.json instead and leaves the real file untouched.
"""
import argparse
import json
import sys
import warnings
from pathlib import Path

import pandas as pd

from src.clean import realtime_path
from src.combine import STALE_HOURS
from src.config import MODELS_DIR, RESULTS_DIR
from src.gauges import load_gauges
from src.live import parse_simulate, predict_gauge

warnings.filterwarnings("ignore", category=UserWarning)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stations", default=None, help="comma-separated station numbers")
    ap.add_argument("--offline", action="store_true", help="no network: use cached rain, else impute")
    ap.add_argument("--out", default=None, help="where to write the readings JSON")
    ap.add_argument("--simulate", nargs="*", default=None, metavar="STATION=PCT",
                    help="what-if: set a gauge's latest level+discharge to this percentile of its training data")
    a = ap.parse_args(argv)
    sim = parse_simulate(a.simulate)
    thresholds = json.loads((MODELS_DIR / "thresholds.json").read_text())
    g = load_gauges()
    stations = a.stations.split(",") if a.stations else list(g.index)
    now = pd.Timestamp.now(tz="UTC")
    rows, out = [], {}
    for st in stations:
        r = dict(station=st, name=g.loc[st, "name"][:30])
        if not (MODELS_DIR / f"{st}.joblib").exists():
            rows.append({**r, "status": "no model (run python run_all.py)"})
            out[st] = {"p": None, "time": None}
            continue
        if not realtime_path(st).exists():
            rows.append({**r, "status": f"no realtime file (python flood_data.py realtime {st})"})
            out[st] = {"p": None, "time": None}
            continue
        try:
            res = predict_gauge(st, sim.get(st), offline=a.offline)
        except ValueError as e:
            rows.append({**r, "status": str(e)})
            out[st] = {"p": None, "time": None}
            continue
        info = res["info"]
        age = (now - pd.Timestamp(res["time"])).total_seconds() / 3600
        status = "ok" if thresholds[st].get("usable", True) else "usable=false (not used by the combiner)"
        rows.append({**r, "set": res["feature_set"], "model": res["model"], "features_day": res["features_day"],
                     "level_m": round(info["level_mean"], 3),
                     "simulated": f"p{sim[st]:g} (real {info['real_level_mean']:.3f})" if st in sim else "",
                     "p_high_tomorrow": round(res["p"], 4), "level": res["level"],
                     "watch": round(res["watch"], 3), "warning": round(res["warning"], 3),
                     "latest_utc": res["time"][:16], "age_h": round(age, 1), "stale": age > STALE_HOURS,
                     "daily_rain": info["daily_rain"].split(" (")[0][:12], "hourly_rain": info["hourly_rain"][:12],
                     "imputed_rain_feats": len(info["imputed_rain"]), "status": status})
        out[st] = {"p": res["p"], "time": res["time"], "level": res["level"], "features_day": res["features_day"],
                   "feature_set": res["feature_set"], "imputed": info["imputed"],
                   "simulated": res["simulated"], "simulation": res["simulation"]}
    t = pd.DataFrame(rows)
    if sim:
        print(f"!!! SIMULATION: {', '.join(f'{s}=p{v:g}' for s, v in sim.items())} - these rows are what-ifs, "
              f"not real readings !!!")
    with pd.option_context("display.width", 300, "display.max_columns", 25):
        print(t.fillna("").to_string(index=False))
    if "imputed_rain_feats" in t and (t["imputed_rain_feats"].fillna(0) > 0).any():
        print("\n!!! some rain features were missing (not yet published, or --offline without cache) and were "
              "imputed with the train median; see 'imputed' in the JSON !!!")
    print(f"Probabilities are for TOMORROW from the last complete local day ('features_day'); "
          f"stale = latest raw reading older than {STALE_HOURS:g} h.")
    target = Path(a.out) if a.out else RESULTS_DIR / ("simulated_readings.json" if sim else "latest_readings.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, indent=2))
    print(f"Wrote {target}" + ("  (real latest_readings.json untouched)" if sim else ""))
    return out


if __name__ == "__main__":
    main(sys.argv[1:])
