"""Final accuracy test of Model B on the held-out TEST periods. Nothing is refit or re-tuned: it scores the
saved predictions (results/modelb/predictions.csv) with the cut-offs already fixed on validation
(models/thresholds.json).

  gauges   : each gauge's own model at WATCH and at WARNING
  combiner : as deployed - R = 15 km, max(nearest p, 1/d^2-weighted mean p), alert cut-offs from the nearest
             gauge - with the gauge itself LEFT OUT (predicted only from neighbours), on its test dates where
             every neighbour has an out-of-train prediction
Baseline on the same rows: always "no high water" (persistence is in results/modelb_results.csv).

python -m src.final_eval
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, balanced_accuracy_score, confusion_matrix, f1_score,
                             fbeta_score, precision_score, recall_score, roc_auc_score)

from .config import MODELS_DIR, RESULTS_DIR
from .experiments import events
from .gauges import distance_matrix, load_gauges
from .loo import load_predictions, matrices, scores

R = 15.0


def metrics(dates, y, p, cut):
    pred = (p >= cut).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    n_ev, caught, before = events(dates, y, pred, "next")
    return dict(n_days=len(y), high_days=int(y.sum()), accuracy=(tp + tn) / len(y),
                always_no_accuracy=1 - y.mean(), balanced_accuracy=balanced_accuracy_score(y, pred),
                precision=precision_score(y, pred, zero_division=0), recall=recall_score(y, pred, zero_division=0),
                f1=f1_score(y, pred, zero_division=0), f2=fbeta_score(y, pred, beta=2, zero_division=0),
                pr_auc=average_precision_score(y, p) if y.sum() else np.nan,
                roc_auc=roc_auc_score(y, p) if 0 < y.sum() < len(y) else np.nan,
                tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp), events=f"{caught}/{n_ev}",
                events_caught=caught, events_total=n_ev, flagged_day_before=before)


def main():
    th = json.loads((MODELS_DIR / "thresholds.json").read_text())
    preds = load_predictions(RESULTS_DIR / "modelb" / "predictions.csv")
    rows = []

    # ---- gauges: own model on its own TEST split
    for st, d in preds.items():
        t = d[d["split"] == "test"]
        y, p = t["y"].astype(int).to_numpy(), t["p"].to_numpy()
        for lvl in ("watch", "warning"):
            rows.append(dict(kind="gauge", station=st, usable=th[st]["usable"], level=lvl.upper(),
                             cut=th[st][lvl], **metrics(t.index, y, p, th[st][lvl])))

    # ---- combiner as deployed, leave-one-gauge-out
    usable = {s: p for s, p in preds.items() if th[s]["usable"]}
    D = distance_matrix(load_gauges().loc[list(usable)])
    P, Y, S = matrices(usable)
    for G in P.columns:
        nb = [s for s in P.columns if s != G and D.loc[G, s] <= R]
        if not nb:
            rows.append(dict(kind="combiner", station=G, usable=True, level="-",
                             note=f"no usable gauge within {R:g} km (nearest {D.loc[G].drop(G).min():.1f} km)"))
            continue
        dates = P.loc[S.index[S[G] == "test"], [G] + nb].dropna().index
        y = Y.loc[dates, G].astype(int).to_numpy()
        comb = scores(G, nb, D, P, dates, th)["raw"]
        nearest = nb[int(np.argmin(D.loc[G, nb].to_numpy()))]
        for lvl in ("watch", "warning"):
            rows.append(dict(kind="combiner", station=G, usable=True, level=lvl.upper(), cut=th[nearest][lvl],
                             nearest=nearest, nearest_km=round(float(D.loc[G, nearest]), 1), n_neighbours=len(nb),
                             **metrics(dates, y, comb, th[nearest][lvl])))

    t = pd.DataFrame(rows)
    t.to_csv(RESULTS_DIR / "final_accuracy.csv", index=False)
    show = ["station", "level", "n_days", "high_days", "accuracy", "always_no_accuracy", "balanced_accuracy",
            "precision", "recall", "f1", "f2", "pr_auc", "roc_auc", "tn", "fp", "fn", "tp", "events",
            "flagged_day_before"]
    with pd.option_context("display.width", 320, "display.max_columns", 30):
        for kind, title in (("gauge", "GAUGE MODELS (own model, own TEST split)"),
                            ("combiner", f"COMBINER as deployed (R = {R:g} km, gauge left out, its TEST dates)")):
            for lvl in ("WATCH", "WARNING"):
                k = t[(t.kind == kind) & (t.level == lvl)]
                print(f"\n=== {title} - {lvl} cut-offs fixed on validation ===")
                print(k[show + (["nearest", "nearest_km"] if kind == "combiner" else ["usable"])].round(3)
                      .to_string(index=False))
                ok = k[k.usable] if kind == "gauge" else k
                pooled_tp, pooled_fp, pooled_fn, pooled_tn = ok.tp.sum(), ok.fp.sum(), ok.fn.sum(), ok.tn.sum()
                print(f"  summary over {len(ok)} {'usable ' if kind == 'gauge' else ''}gauges: "
                      f"mean accuracy {ok.accuracy.mean():.3f} (always-no {ok.always_no_accuracy.mean():.3f}), "
                      f"mean balanced acc {ok.balanced_accuracy.mean():.3f}, mean precision {ok.precision.mean():.3f}, "
                      f"mean recall {ok.recall.mean():.3f}, mean F2 {ok.f2.mean():.3f}, mean PR-AUC "
                      f"{ok.pr_auc.mean():.3f}, mean ROC-AUC {ok.roc_auc.mean():.3f}; events caught "
                      f"{int(ok.events_caught.sum())}/{int(ok.events_total.sum())}; pooled precision "
                      f"{pooled_tp / max(pooled_tp + pooled_fp, 1):.3f}, pooled recall "
                      f"{pooled_tp / max(pooled_tp + pooled_fn, 1):.3f}")
        skipped = t[(t.kind == "combiner") & (t.level == "-")]
        for _, r in skipped.iterrows():
            print(f"  combiner not evaluated for {r.station}: {r.note}")
    print("\nAccuracy is reported but is not a good yardstick here: high-water days are ~3-6% of test days, so "
          "always answering 'no' already scores 94-98% while catching nothing.")
    print("Wrote results/final_accuracy.csv")


if __name__ == "__main__":
    main()
