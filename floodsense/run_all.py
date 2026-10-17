"""FloodSense: one entry point.

python run_all.py                       # Model B: 11 gauges, LEAN vs RATE per gauge, known floods, combiner LOO test
python run_all.py --fast                # same with n_iter=10
python run_all.py --stations 02HC013,02HC058,02HC022   # limit to some gauges
python run_all.py --fleet-lean          # the earlier LEAN-only fleet (models/fleet_lean/)
python run_all.py --v2                  # earlier 3-station study: feature sets, targets, p95/p97
python run_all.py --v1                  # v1 raw-features baseline (3 stations)
python run_all.py --multiclass          # NORMAL / ELEVATED / HIGH variant (3 stations)
"""
import argparse
import json
import time
import warnings

import joblib
import numpy as np
import pandas as pd

from src import clean, experiments, fleet, loo, modelb, multiclass
from src.config import DEFAULT_PCT, MODELS_DIR, RANDOM_STATE, RESULTS_DIR, STATIONS
from src.dataset import build, print_split
from src.evaluate import evaluate_station, pick_winner, print_table
from src.models import MODEL_NAMES
from src.tune import tune_station

warnings.filterwarnings("ignore", category=UserWarning, message=".*feature names.*")


def explain(station, table, winner, v):
    val = table[table.split == "val"].set_index("model")
    test = table[table.split == "test"].set_index("model")
    w, wt, pt = val.loc[winner], test.loc[winner], test.loc["persistence"]
    runner = v[v.model != winner].sort_values("pr_auc", ascending=False).iloc[0]
    lines = [
        f"1. Winner {winner}: validation PR-AUC {w.pr_auc:.3f}, F2 {w.f2:.3f} at cut-off {w.cutoff:.4f} "
        f"(train CV PR-AUC {w.cv_pr_auc:.3f} +/- {w.cv_pr_auc_std:.3f}).",
        f"2. Runner-up {runner.model}: validation PR-AUC {runner.pr_auc:.3f}, F2 {runner.f2:.3f}; "
        f"ties within 0.01 go to the simpler model.",
        f"3. On TEST (cut-off fixed from validation): precision {wt.precision:.3f}, recall {wt.recall:.3f}, "
        f"F2 {wt.f2:.3f}, PR-AUC {wt.pr_auc:.3f}, events caught {wt.events_caught}/{wt.events}.",
        f"4. Persistence on TEST: precision {pt.precision:.3f}, recall {pt.recall:.3f}, F2 {pt.f2:.3f}, "
        f"events caught {pt.events_caught}/{pt.events}.",
        f"5. Only {int(wt.tp + wt.fn)} high days / {wt.events} events in test and train-CV PR-AUC std up to "
        f"{table[table.model.isin(MODEL_NAMES)].cv_pr_auc_std.max():.3f}: small gaps are within noise.",
    ]
    print("  Winner explanation:")
    for line in lines:
        print("   ", line)
    beats = test.loc[MODEL_NAMES, "f2"] > pt.f2
    if not beats.any():
        print(f"  >>> No ML model beats persistence on TEST F2 ({pt.f2:.3f}) for {station}. With raw same-day "
              f"features this is an expected possible result, not a failure.")
    else:
        print(f"  >>> Models beating persistence on TEST F2 ({pt.f2:.3f}): "
              + ", ".join(f"{m} ({test.loc[m, 'f2']:.3f})" for m in beats[beats].index))
    return lines, bool(beats[winner])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="n_iter=10 instead of 40")
    ap.add_argument("--v1", action="store_true", help="run the v1 raw-features baseline instead of v2")
    ap.add_argument("--multiclass", action="store_true", help="run the 3-class NORMAL/ELEVATED/HIGH variant")
    ap.add_argument("--v2", action="store_true", help="run the earlier 3-station v2 study")
    ap.add_argument("--stations", default=None, help="fleet / Model B: comma-separated station numbers")
    ap.add_argument("--fleet-lean", action="store_true", help="run the earlier LEAN-only fleet")
    ap.add_argument("--pct", type=float, default=DEFAULT_PCT, help="v1 only: high-water percentile of train LEVEL")
    args = ap.parse_args()
    n_iter = 10 if args.fast else 40
    np.random.seed(RANDOM_STATE)
    RESULTS_DIR.mkdir(exist_ok=True)
    MODELS_DIR.mkdir(exist_ok=True)

    stations = args.stations.split(",") if args.stations else None
    if args.fleet_lean:
        t0 = time.time()
        cleaned, preds, thresholds, _ = fleet.run(stations, n_iter)
        fleet.known_floods(cleaned, preds, thresholds)
        loo.run(preds, thresholds)
        print()
        print(f"LEAN fleet done in {time.time() - t0:.0f}s -> results/fleet_results.csv, results/fleet/, models/fleet_lean/")
        return
    if not (args.v1 or args.v2 or args.multiclass):
        t0 = time.time()
        cleaned, preds, thresholds, _ = modelb.run(stations, n_iter)
        fleet.known_floods(cleaned, preds, thresholds, out=modelb.OUT)
        loo.run(preds, thresholds, out=modelb.OUT)
        if (RESULTS_DIR / "fleet" / "loo_results.csv").exists():
            modelb.compare_loo(RESULTS_DIR / "fleet" / "loo_results.csv", modelb.OUT / "loo_results.csv")
        from src import model_card
        model_card.main()
        print()
        print(f"Model B done in {time.time() - t0:.0f}s -> results/modelb_results.csv, results/modelb/, models/")
        return
    cleaned, has_rain = clean.run()
    if args.v1:
        run_v1(cleaned, has_rain, args, n_iter)
    elif args.multiclass:
        multiclass.run(cleaned, has_rain, n_iter)
    else:
        experiments.run(cleaned, has_rain, n_iter)


def run_v1(cleaned, has_rain, args, n_iter):
    t0 = time.time()
    all_tables, all_params, thresholds, tuning, explanations = [], {}, {}, [], {}
    for station in STATIONS:
        out = RESULTS_DIR / station
        out.mkdir(exist_ok=True)
        print(f"\n################ {station} ################")
        print("\n=== STEPS 2-4: label, features, split ===")
        sp = build(station, cleaned[station], has_rain, args.pct)
        print_split(sp, cleaned[station])
        print(f"Steps 2-4 summary: {len(sp.features)} raw features, train/val/test positives "
              f"{int(sp.y['train'].sum())}/{int(sp.y['val'].sum())}/{int(sp.y['test'].sum())}.")

        print("\n=== STEP 5: tuning (train only) ===")
        tab, best = tune_station(sp, n_iter, out)
        tuning.append(tab.assign(station=station))
        all_params[station] = best
        kept = [m for m, p in best.items() if p]
        print(f"Step 5 summary: tuned {len(best)} models; tuned params kept for {kept or 'none'}.")

        print("\n=== STEP 6: evaluation ===")
        table, fitted, cutoffs, _ = evaluate_station(sp, best, out)
        print_table(table)
        print("    NOTE: with this few high-water events, small differences between models are within noise.")
        all_tables.append(table)
        print(f"Step 6 summary: {table.model.nunique()} models/baselines evaluated on val and test; plots in {out}.")

        print("\n=== STEP 7: winner ===")
        winner, v = pick_winner(table)
        lines, beats = explain(station, table, winner, v)
        explanations[station] = lines
        joblib.dump(dict(pipeline=fitted[winner], model=winner, features=sp.features, cutoff=cutoffs[winner],
                         level_threshold=sp.threshold, pct=sp.pct, has_rain=has_rain, station=station,
                         train_end=str(sp.y["train"].index.max().date())),
                    MODELS_DIR / f"best_{station}.joblib")
        thresholds[station] = dict(model=winner, decision_cutoff=cutoffs[winner], level_threshold_m=sp.threshold,
                                   label_percentile=sp.pct, beats_persistence_on_test_f2=beats)
        print(f"Step 7 summary: saved models/best_{station}.joblib ({winner}).")

    pd.concat(all_tables).to_csv(RESULTS_DIR / "model_comparison.csv", index=False)
    pd.concat(tuning).to_csv(RESULTS_DIR / "default_vs_tuned.csv", index=False)
    (RESULTS_DIR / "best_params.json").write_text(json.dumps(all_params, indent=2))
    (MODELS_DIR / "threshold.json").write_text(json.dumps(thresholds, indent=2))
    (RESULTS_DIR / "winner_explanations.json").write_text(json.dumps(explanations, indent=2))
    print(f"\nDone in {time.time() - t0:.0f}s. Wrote results/model_comparison.csv, results/default_vs_tuned.csv, "
          f"results/best_params.json, models/threshold.json, models/best_*.joblib.")


if __name__ == "__main__":
    main()
