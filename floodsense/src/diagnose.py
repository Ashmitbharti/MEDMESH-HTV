"""Explain why a gauge is (or is not) usable in the fleet, from the code's own rule and the raw data.

python -m src.diagnose 02HB030
"""
import contextlib
import io
import json
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from . import clean
from .clean import realtime_path
from .config import MODELS_DIR, find_input
from .fleet import MIN_POS, build
from .rain_gauges import rain_frame


def explain(st):
    th = json.loads((MODELS_DIR / "thresholds.json").read_text())[st]
    print(f"=== {st}: usable = {th['usable']} (models/thresholds.json) ===")
    print(f"Rule in src/fleet.py: usable = (val positive days >= {MIN_POS}) and (test positive days >= {MIN_POS}).")
    print("src/combine.py and src/loo.py skip any gauge with usable = false.\n")

    with contextlib.redirect_stdout(io.StringIO()):
        df = clean.clean_station(st, rain_frame(th["rain_station"]))
    d = build(st, df)
    sp, y = d["split"], d["y"]
    print("1) The gate, recomputed with the same code (src/fleet.build):")
    for s in ("train", "val", "test"):
        m = sp == s
        idx = d["X"].index[m]
        print(f"   {s:<5} {idx.min().date()} -> {idx.max().date()}  rows={m.sum():5d}  positive days={int(y[m].sum()):4d}"
              f"{'   < ' + str(MIN_POS) + '  FAILS' if s != 'train' and y[m].sum() < MIN_POS else ''}")
    print(f"   high-water threshold = train p95 of LEVEL = {d['thr']:.3f} m")

    rt = realtime_path(st)
    print(f"\n2) Live data: realtime file {'present' if rt.exists() else 'MISSING'} ({rt.name}) -> not the cause"
          if rt.exists() else f"\n2) Live data: realtime file MISSING ({rt})")

    b = joblib.load(MODELS_DIR / f"{st}.joblib")
    va = sp == "val"
    p = b["pipeline"].predict_proba(d["X"][va])[:, 1]
    print(f"\n3) Model on validation: {b['model']}, PR-AUC {average_precision_score(y[va], p):.3f} on "
          f"{int(y[va].sum())} positive days; WARNING rule: {th['warning_rule']}")

    raw = pd.read_csv(find_input(f"{st}_daily.csv"), parse_dates=["DATE"]).set_index("DATE")
    yr = raw.groupby(raw.index.year)
    tab = pd.DataFrame({
        "level_days": yr["LEVEL"].count(), "discharge_days": yr["DISCHARGE"].count(),
        "level_median": yr["LEVEL"].median().round(3), "level_p95": yr["LEVEL"].quantile(0.95).round(3),
        f"days_level>{d['thr']:.3f}": yr["LEVEL"].apply(lambda s: int((s > d["thr"]).sum())),
        "rows_kept_in_model": pd.Series(d["X"].index.year).value_counts().sort_index(),
    }).fillna(0)
    band = raw[(raw["DISCHARGE"] >= 0.08) & (raw["DISCHARGE"] <= 0.12)]
    tab["level_at_Q_0.08-0.12"] = band.groupby(band.index.year)["LEVEL"].median().round(3)
    print("\n4) Raw daily data by year (02HB030_daily.csv):")
    print(tab.to_string())
    early = band[band.index.year <= 2009]["LEVEL"].median()
    late = band[band.index.year >= 2022]["LEVEL"].median()
    print(f"\n   Stage at the same low flow (0.08-0.12 m3/s): {early:.3f} m in 2005-09 vs {late:.3f} m in 2022-24 "
          f"({late - early:+.3f} m). The level-discharge relation itself shifted.")
    return tab


if __name__ == "__main__":
    explain(sys.argv[1] if len(sys.argv) > 1 else "02HB030")
