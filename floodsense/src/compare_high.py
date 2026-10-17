"""Binary p95 model vs 3-class model on the HIGH class (LEVEL[t+1] > train p95), per station.

Uses the saved models (models/v2/best_{s}_next_p95.joblib, models/multiclass/best_{s}.joblib) on
identical rows/features. Nothing is tuned on test:
  * fixed operating points come from validation (binary F2 cut-off; 3-class argmax and safety rule)
  * the equal-recall threshold is the highest score that reaches >= 70% recall on VALIDATION,
    then applied once to test
  * noise: both models are refit (same params) on each TimeSeriesSplit fold of TRAIN; fold std of
    HIGH PR-AUC and of precision at the fold's own 70%-recall point

python -m src.compare_high
"""
import contextlib
import io
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import average_precision_score, fbeta_score, precision_score, recall_score

from . import clean
from .config import MODELS_DIR, RESULTS_DIR, STATIONS
from .experiments import events
from .multiclass import apply_rule, build, ordinal_proba
from .tune import tscv

warnings.filterwarnings("ignore", category=UserWarning)
TARGET_RECALL = 0.70


def threshold_for_recall(y, s, target=TARGET_RECALL):
    """Highest threshold t with recall(s >= t) >= target."""
    pos = np.sort(s[y == 1])[::-1]
    k = int(np.ceil(target * len(pos)))
    return float(pos[k - 1])


def high_score_mc(bundle_models, kind, X):
    if kind == "direct":
        return bundle_models["direct"].predict_proba(X)[:, 2]
    return ordinal_proba(bundle_models["p90"], bundle_models["p95"], X)[:, 2]


def fold_noise(Xtr, ytr3, b, m):
    """Refit clones of both models per TimeSeriesSplit fold on TRAIN; return per-fold metrics."""
    out = []
    y2 = (ytr3 == 2).astype(int)
    for tr, te in tscv().split(Xtr):
        Xa, Xb = Xtr.iloc[tr], Xtr.iloc[te]
        yb = y2.iloc[te].to_numpy()
        if yb.sum() < 2:
            continue
        sb = clone(b["pipeline"]).fit(Xa, y2.iloc[tr]).predict_proba(Xb)[:, 1]
        if m["kind"] == "direct":
            mods = {"direct": clone(m["models"]["direct"]).fit(Xa, ytr3.iloc[tr])}
        else:
            mods = {"p90": clone(m["models"]["p90"]).fit(Xa, (ytr3.iloc[tr] >= 1).astype(int)),
                    "p95": clone(m["models"]["p95"]).fit(Xa, y2.iloc[tr])}
        sm = high_score_mc(mods, m["kind"], Xb)
        row = {}
        for name, s in (("binary", sb), ("3class", sm)):
            t = threshold_for_recall(yb, s)
            row[f"{name}_ap"] = average_precision_score(yb, s)
            row[f"{name}_prec70"] = precision_score(yb, (s >= t).astype(int), zero_division=0)
        out.append(row)
    return pd.DataFrame(out)


def op_metrics(dates, y2, score, pred):
    n, caught, _ = events(dates, y2, pred, "next")
    return dict(recall=recall_score(y2, pred, zero_division=0), precision=precision_score(y2, pred, zero_division=0),
                f2=fbeta_score(y2, pred, beta=2, zero_division=0), pr_auc=average_precision_score(y2, score),
                events=f"{caught}/{n}")


def main():
    with contextlib.redirect_stdout(io.StringIO()):
        cleaned, has_rain = clean.run()
    rows = []
    for st in STATIONS:
        d = build(st, cleaned[st], has_rain)
        b = joblib.load(MODELS_DIR / "v2" / f"best_{st}_next_p95.joblib")
        m = joblib.load(MODELS_DIR / "multiclass" / f"best_{st}.joblib")
        assert b["features"] == d["cols"] == m["features"] and abs(b["level_threshold"] - d["p95"]) < 1e-9
        sp, X, y3 = d["split"], d["X"], d["y"]
        Xva, Xte = X[sp == "val"], X[sp == "test"]
        yva = (y3[sp == "val"] == 2).astype(int).to_numpy()
        yte = (y3[sp == "test"] == 2).astype(int).to_numpy()
        dte = X.index[sp == "test"]

        sb_va, sb_te = b["pipeline"].predict_proba(Xva)[:, 1], b["pipeline"].predict_proba(Xte)[:, 1]
        P_va = (m["models"]["direct"].predict_proba(Xva) if m["kind"] == "direct"
                else ordinal_proba(m["models"]["p90"], m["models"]["p95"], Xva))
        P_te = (m["models"]["direct"].predict_proba(Xte) if m["kind"] == "direct"
                else ordinal_proba(m["models"]["p90"], m["models"]["p95"], Xte))
        sm_va, sm_te = P_va[:, 2], P_te[:, 2]

        noise = fold_noise(X[sp == "train"], y3[sp == "train"], b, m)
        nz = {c: (noise[c].mean(), noise[c].std(ddof=0)) for c in noise.columns}

        tb, tm = threshold_for_recall(yva, sb_va), threshold_for_recall(yva, sm_va)
        ops = [
            (f"binary p95 ({b['model']})", "F2 cut-off (val)", b["cutoff"], sb_te, (sb_te >= b["cutoff"]).astype(int), "binary"),
            (f"3-class ({m['candidate']})", "argmax", np.nan, sm_te, (apply_rule(P_te, "argmax") == 2).astype(int), "3class"),
            (f"3-class ({m['candidate']})", "safety rule t2 (val)", m["t2"], sm_te,
             (apply_rule(P_te, "safety", m["t1"], m["t2"]) == 2).astype(int), "3class"),
            (f"binary p95 ({b['model']})", "70% recall on val", tb, sb_te, (sb_te >= tb).astype(int), "binary"),
            (f"3-class ({m['candidate']})", "70% recall on val", tm, sm_te, (sm_te >= tm).astype(int), "3class"),
        ]
        for model, op, thr, s, pred, key in ops:
            val_rec = np.nan
            if op.startswith("70%"):
                val_rec = recall_score(yva, ((sb_va if key == "binary" else sm_va) >= thr).astype(int))
            rows.append(dict(station=st, model=model, operating_point=op, threshold=thr, val_recall=val_rec,
                             **op_metrics(dte, yte, s, pred),
                             cv_pr_auc=f"{nz[key + '_ap'][0]:.3f}+/-{nz[key + '_ap'][1]:.3f}",
                             cv_prec_at70=f"{nz[key + '_prec70'][0]:.3f}+/-{nz[key + '_prec70'][1]:.3f}",
                             _ap_std=nz[key + "_ap"][1], _p70_std=nz[key + "_prec70"][1],
                             _p70_mean=nz[key + "_prec70"][0], _ap_mean=nz[key + "_ap"][0]))
        print(f"\n===== {st}: HIGH class = LEVEL tomorrow > {d['p95']:.3f} m (train p95); TEST, "
              f"{int(yte.sum())} high days, thresholds fixed on validation =====")
        t = pd.DataFrame([r for r in rows if r["station"] == st])
        with pd.option_context("display.width", 250, "display.max_columns", 20):
            print(t.drop(columns=["station"] + [c for c in t.columns if c.startswith("_")])
                  .round(3).to_string(index=False))
        e = t[t.operating_point == "70% recall on val"].set_index(t[t.operating_point == "70% recall on val"]
                                                                   .model.str.split(" ").str[0])
        diff = e.loc["binary", "precision"] - e.loc["3-class", "precision"]
        std = max(e.loc["binary", "_p70_std"], e.loc["3-class", "_p70_std"])
        apd = e.loc["binary", "pr_auc"] - e.loc["3-class", "pr_auc"]
        apstd = max(e.loc["binary", "_ap_std"], e.loc["3-class", "_ap_std"])
        verdict = ("WITHIN fold std (no real difference)" if abs(diff) <= std
                   else f"{'binary' if diff > 0 else '3-class'} is better")
        print(f"  equal-recall verdict: test precision binary {e.loc['binary', 'precision']:.3f} vs 3-class "
              f"{e.loc['3-class', 'precision']:.3f} (diff {diff:+.3f}); fold std of precision@70% recall "
              f"<= {std:.3f} -> {verdict}")
        print(f"  ranking check: test HIGH PR-AUC binary {e.loc['binary', 'pr_auc']:.3f} vs 3-class "
              f"{e.loc['3-class', 'pr_auc']:.3f} (diff {apd:+.3f}); fold std <= {apstd:.3f} -> "
              f"{'WITHIN fold std' if abs(apd) <= apstd else ('binary' if apd > 0 else '3-class') + ' better'}")
    out = pd.DataFrame(rows).drop(columns=[c for c in rows[0] if c.startswith("_")])
    out.to_csv(RESULTS_DIR / "high_class_comparison.csv", index=False)
    print("\nSaved results/high_class_comparison.csv")


if __name__ == "__main__":
    main()
