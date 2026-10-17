"""Fleet step 4: leave-one-gauge-out test of the combiner.

For each usable gauge G and radius R, using only dates where G and every neighbour within R has an
out-of-train prediction (the neighbour's row is in its own val or test split, never its train split):
  raw      : current combiner, max(nearest p, inverse-square weighted mean p), G excluded, distances from G
  norm     : same formula on score = p / WATCH of each neighbour (each gauge's own validation cut-off)
  own      : G's own model
  mean_all : unweighted mean of ALL other usable gauges available that day
  mean_R   : unweighted mean of the same neighbours as raw (isolates the effect of weighting)
  nearest  : the nearest neighbour alone
Thresholds are chosen on VALIDATION, never on test:
  * val-F2 : F2-optimal cut-off for each method on G's validation dates (same out-of-train rule);
             own uses G's WATCH (itself F2-optimal on G's validation). Needs >= 5 positive val days,
             else the deployment rule below is used and flagged.
  * deploy : what the live combiner would use at G's location: raw/mean/nearest -> nearest neighbour's
             WATCH; norm -> 1.0 (= "at WATCH" on the normalised scale); own -> G's WATCH.
Noise: each gauge's test window is cut into 5 chronological folds; the fold std of (mean over gauges of
norm PR-AUC - raw PR-AUC) is the yardstick for "better than noise".
This tests spatial transfer between gauges, not street-level flooding.

python -m src.loo          # reruns from results/fleet/predictions.csv + models/thresholds.json (no retraining)
"""
import json
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_score, recall_score

if __package__ in (None, ""):
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "src"

from .combine import weights
from .config import MODELS_DIR, RESULTS_DIR
from .evaluate import best_f2_threshold
from .experiments import events
from .gauges import distance_matrix, load_gauges

warnings.filterwarnings("ignore", message=".*No positive class found in y_true.*")
OUT = RESULTS_DIR / "fleet"
RADII = (10, 15, 25)
PAIR = ("02HC013", "02HC058")
METHODS = ("raw", "norm", "own", "mean_all", "mean_R", "nearest")
N_FOLDS = 5
MIN_VAL_POS = 5


def matrices(preds):
    P = pd.DataFrame({s: d["p"].where(d["split"] != "train") for s, d in preds.items()})
    Y = pd.DataFrame({s: d["y"] for s, d in preds.items()})
    S = pd.DataFrame({s: d["split"] for s, d in preds.items()})
    return P, Y, S


def scores(G, nb, D, P, dates, thresholds):
    sub = P.loc[dates, [G] + nb]
    d = D.loc[G, nb].to_numpy()
    w = weights(d)
    i = int(np.argmin(d))
    Pn = sub[nb].to_numpy()
    watch = np.array([thresholds[s]["watch"] for s in nb])
    Sn = Pn / watch
    others = [s for s in P.columns if s != G]
    return {
        "raw": np.maximum(Pn[:, i], (Pn * w).sum(axis=1) / w.sum()),
        "norm": np.maximum(Sn[:, i], (Sn * w).sum(axis=1) / w.sum()),
        "own": sub[G].to_numpy(),
        "mean_all": P.loc[dates, others].mean(axis=1, skipna=True).to_numpy(),
        "mean_R": Pn.mean(axis=1),
        "nearest": Pn[:, i],
    }


def deploy_cut(method, G, nearest, thresholds):
    if method == "own":
        return thresholds[G]["watch"]
    if method == "norm":
        return 1.0
    return thresholds[nearest]["watch"]


def pr(dates, y, s, cut):
    pred = (s >= cut).astype(int)
    n, caught, _ = events(dates, y, pred, "next")
    return dict(precision=precision_score(y, pred, zero_division=0), recall=recall_score(y, pred, zero_division=0),
                events=f"{caught}/{n}")


def evaluate_gauge(G, nb, D, P, Y, S, thresholds, R):
    test = P.loc[S.index[S[G] == "test"], [G] + nb].dropna().index
    val = P.loc[S.index[S[G] == "val"], [G] + nb].dropna().index
    if len(test) == 0:
        return None, None
    nearest = nb[int(np.argmin(D.loc[G, nb].to_numpy()))]
    yt = Y.loc[test, G].astype(int).to_numpy()
    yv = Y.loc[val, G].astype(int).to_numpy()
    st, sv = scores(G, nb, D, P, test, thresholds), scores(G, nb, D, P, val, thresholds) if len(val) else None
    base = dict(gauge=G, R=R, n_neighbours=len(nb), nearest=nearest,
                nearest_km=round(float(D.loc[G, nearest]), 1), test_days=len(test), test_pos=int(yt.sum()),
                val_days=len(val), val_pos=int(yv.sum()))
    rows = []
    for m in METHODS:
        dep = deploy_cut(m, G, nearest, thresholds)
        if m == "own":
            vcut, vsrc = thresholds[G]["watch"], "G WATCH (val)"
        elif sv is not None and yv.sum() >= MIN_VAL_POS:
            vcut, vsrc = best_f2_threshold(yv, sv[m])[0], "F2 on G val"
        else:
            vcut, vsrc = dep, "deploy (val too small)"
        a = pr(test, yt, st[m], vcut)
        b = pr(test, yt, st[m], dep)
        rows.append({**base, "method": m, "pr_auc": average_precision_score(yt, st[m]) if yt.sum() else np.nan,
                     "val_cut": vcut, "val_cut_source": vsrc, **a,
                     "deploy_cut": dep, "deploy_precision": b["precision"], "deploy_recall": b["recall"],
                     "deploy_events": b["events"]})
    # chronological folds of the test window for the noise estimate
    folds = []
    for k, idx in enumerate(np.array_split(np.arange(len(test)), N_FOLDS)):
        yk = yt[idx]
        if yk.sum() == 0:
            continue
        folds.append({"gauge": G, "R": R, "fold": k,
                      **{m: average_precision_score(yk, st[m][idx]) for m in ("raw", "norm", "own")}})
    return rows, folds


def run(preds, thresholds, radii=RADII, out=None):
    global OUT
    OUT = out or OUT
    OUT.mkdir(parents=True, exist_ok=True)
    bad = {s: thresholds[s].get("usable_reason", "usable=false") for s in preds
           if thresholds[s].get("usable", True) is False}
    for s, why in bad.items():
        print(f"\n  excluded from the leave-one-out test: {s} ({why})")
    preds = {s: p for s, p in preds.items() if s not in bad}
    g = load_gauges().loc[list(preds)]
    D = distance_matrix(g)
    P, Y, S = matrices(preds)
    rows, folds, skipped = [], [], []
    print(f"\n=== STEP 4 (fleet): leave-one-gauge-out test, {len(P.columns)} usable gauges, TEST dates only ===")
    for R in radii:
        for G in P.columns:
            nb = [s for s in P.columns if s != G and D.loc[G, s] <= R]
            if not nb:
                skipped.append(dict(gauge=G, R=R, why=f"no usable neighbour within {R} km "
                                                      f"(nearest {D.loc[G].drop(G).min():.1f} km)"))
                continue
            r, f = evaluate_gauge(G, nb, D, P, Y, S, thresholds, R)
            if r is None:
                skipped.append(dict(gauge=G, R=R, why="no common out-of-train test dates"))
                continue
            rows += r
            folds += f
    t, fo = pd.DataFrame(rows), pd.DataFrame(folds)
    t.to_csv(OUT / "loo_results.csv", index=False)
    fo.to_csv(OUT / "loo_folds.csv", index=False)
    decisions = {}
    for R in radii:
        decisions[R] = report_radius(R, t[t.R == R], fo[fo.R == R], [s for s in skipped if s["R"] == R], P.columns)
    verdict(decisions)
    pair(D, P, Y, S, thresholds)
    print("\n  Scope: this measures how well OTHER gauges predict a gauge's creek high water. "
          "It does not validate street-level flooding.")
    return t, decisions


def report_radius(R, tr, fr, skipped, gauges):
    print(f"\n  ----- R = {R} km -----")
    piv = tr.pivot_table(index="gauge", columns="method", values="pr_auc")[list(METHODS)].round(3)
    meta = tr.groupby("gauge")[["nearest", "nearest_km", "n_neighbours", "test_days", "test_pos"]].first()
    meta = meta.rename(columns={"nearest": "nearest_gauge"})
    table = meta.join(piv).reindex(gauges)
    for c in ("n_neighbours", "test_days", "test_pos"):
        table[c] = table[c].astype("Int64")
    for s in skipped:
        table.loc[s["gauge"], "nearest_gauge"] = s["why"]
    print("  PR-AUC on G's real TEST labels (all usable gauges):")
    with pd.option_context("display.width", 250, "display.max_columns", 20):
        print(table.astype(object).where(table.notna(), "").to_string())
    cell = tr.assign(cell=tr.precision.map("{:.2f}".format) + "/" + tr.recall.map("{:.2f}".format) + " " + tr.events)
    pc = cell.pivot_table(index="gauge", columns="method", values="cell", aggfunc="first")[["raw", "norm", "own"]]
    src = tr[tr.method.isin(["raw", "norm"])].pivot_table(index="gauge", columns="method", values="val_cut_source",
                                                          aggfunc="first")
    print("  precision/recall + events at cut-offs chosen on G's VALIDATION window:")
    with pd.option_context("display.width", 250):
        print(pc.join(src.add_suffix(" cut from")).to_string())
    m = tr.groupby("method")[["pr_auc", "precision", "recall"]].mean().loc[list(METHODS)]
    fm = fr.groupby("fold")[["raw", "norm", "own"]].mean()
    diff = fm["norm"] - fm["raw"]
    d_full = m.loc["norm", "pr_auc"] - m.loc["raw", "pr_auc"]
    print(f"  mean over {tr.gauge.nunique()} gauges:  " + "  ".join(
        f"{k} PR-AUC {v.pr_auc:.3f} P {v.precision:.2f} R {v.recall:.2f}" for k, v in m.iterrows()))
    print(f"  norm - raw PR-AUC: {d_full:+.3f} on the full test windows; per chronological fold "
          f"{', '.join(f'{x:+.3f}' for x in diff)} -> fold mean {diff.mean():+.3f}, fold std {diff.std(ddof=1):.3f}")
    return dict(diff=d_full, fold_mean=diff.mean(), fold_std=diff.std(ddof=1),
                raw=m.loc["raw"].to_dict(), norm=m.loc["norm"].to_dict())


def verdict(dec):
    print("\n  ===== raw vs normalised combiner =====")
    for R, d in dec.items():
        beats = d["diff"] > d["fold_std"]
        print(f"  R={R:>2} km: norm - raw PR-AUC {d['diff']:+.3f} vs fold std {d['fold_std']:.3f} -> "
              f"{'normalised better beyond noise' if beats else 'NOT beyond noise'}; "
              f"recall raw {d['raw']['recall']:.2f} vs norm {d['norm']['recall']:.2f}, "
              f"precision raw {d['raw']['precision']:.2f} vs norm {d['norm']['precision']:.2f}")
    keep_norm = dec[15]["diff"] > dec[15]["fold_std"] if 15 in dec else False
    print(f"  DECISION (default R = 15 km): {'switch to the normalised combiner' if keep_norm else 'keep the current raw-probability combiner'}")
    return keep_norm


def pair(D, P, Y, S, thresholds):
    if not all(s in P.columns for s in PAIR):
        return
    print(f"\n  ----- Highland pair: {PAIR[0]} Highland Creek <-> {PAIR[1]} West Highland Creek "
          f"({D.loc[PAIR[0], PAIR[1]]:.1f} km) -----")
    rows = []
    for G, other in (PAIR, PAIR[::-1]):
        sub = P.loc[S.index[S[G] == "test"], [G, other]].dropna()
        y = Y.loc[sub.index, G].astype(int).to_numpy()
        for method, p, cut in (("own model", sub[G].to_numpy(), thresholds[G]["watch"]),
                               (f"partner only ({other})", sub[other].to_numpy(), thresholds[other]["watch"])):
            rows.append(dict(gauge=G, method=method, eval_days=len(sub), pos_days=int(y.sum()),
                             pr_auc=average_precision_score(y, p), **pr(sub.index, y, p, cut)))
    pt = pd.DataFrame(rows)
    print(pt.round(3).to_string(index=False))
    pt.to_csv(OUT / "loo_highland_pair.csv", index=False)


def load_predictions(path):
    df = pd.read_csv(path, parse_dates=["date"], dtype={"station": str})
    return {s: g.drop(columns="station").set_index("date") for s, g in df.groupby("station")}


if __name__ == "__main__":
    # the current package (Model B) if it has been run, else the LEAN fleet
    src_dir = RESULTS_DIR / "modelb" if (RESULTS_DIR / "modelb" / "predictions.csv").exists() else OUT
    print(f"using {src_dir / 'predictions.csv'} and models/thresholds.json")
    run(load_predictions(src_dir / "predictions.csv"), json.loads((MODELS_DIR / "thresholds.json").read_text()),
        out=src_dir)
