"""Multiclass NEXT-DAY variant: NORMAL / ELEVATED / HIGH.

class 0: LEVEL[t+1] <= p90    class 1: p90 < LEVEL[t+1] <= p95    class 2: LEVEL[t+1] > p95
p90/p95 are percentiles of LEVEL over the TRAIN period. Same 70/15/15 split and LEAN features as v2.

Candidates per station (all tuned on TRAIN only with TimeSeriesSplit):
  direct-<model>   one 3-class model (scoring f1_macro)
  ordinal-<model>  two binary models P(L>p90), P(L>p95) (scoring average_precision), combined:
                   P2 = min(P>p95, P>p90), P1 = P>p90 - P2, P0 = 1 - P>p90
Decision rules:
  argmax  class with the highest probability
  safety  2 if P2 >= t2, else 1 if P1+P2 >= t1, else 0; t2/t1 = F2-optimal cut-offs on VALIDATION
          for "class 2" and "class >= 1". Test is scored once with them fixed.
"""
import json
import time
import warnings

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from scipy.stats import loguniform, randint, uniform
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (cohen_kappa_score, confusion_matrix, f1_score, precision_recall_fscore_support,
                             precision_score, recall_score)
from sklearn.model_selection import RandomizedSearchCV, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

from .config import MODELS_DIR, RANDOM_STATE, RESULTS_DIR, STATIONS
from .evaluate import best_f2_threshold
from .experiments import events
from .features import build_frame, drop_constant, feature_sets, snow_usable
from .label import split_dates, threshold, usable_rows
from .models import MODEL_NAMES, to_jsonable
from .tune import tscv

warnings.filterwarnings("ignore", category=UserWarning, message=".*feature names.*")
warnings.filterwarnings("ignore", message=".*No positive class found in y_true.*")

OUT = RESULTS_DIR / "multiclass"
LEVELS = ["NORMAL", "ELEVATED", "HIGH"]
MIN_GAIN = 0.01
SIMPLE = {"logreg": 0, "rf": 1, "lgbm": 2, "xgb": 2}


class BalancedXGB(XGBClassifier):
    """XGBoost has no class_weight, so balanced sample weights are computed inside fit (per CV fold)."""

    def fit(self, X, y, **kw):
        return super().fit(X, y, sample_weight=compute_sample_weight("balanced", y))


def pipeline(name, params=None):
    imp = ("impute", SimpleImputer(strategy="median"))
    if name == "logreg":     # lbfgs fits a multinomial model when there are 3 classes (sklearn >= 1.5 default)
        steps = [imp, ("scale", StandardScaler()),
                 ("model", LogisticRegression(max_iter=5000, class_weight="balanced", random_state=RANDOM_STATE))]
    elif name == "rf":
        steps = [imp, ("model", RandomForestClassifier(n_estimators=300, class_weight="balanced",
                                                       random_state=RANDOM_STATE, n_jobs=1))]
    elif name == "lgbm":
        steps = [imp, ("model", LGBMClassifier(class_weight="balanced", subsample_freq=1, random_state=RANDOM_STATE,
                                               n_jobs=1, verbose=-1))]
    elif name == "xgb":
        steps = [imp, ("model", BalancedXGB(random_state=RANDOM_STATE, n_jobs=1, tree_method="hist"))]
    else:
        raise ValueError(name)
    p = Pipeline(steps)
    if params:
        p.set_params(**params)
    return p


def space(name):
    if name == "logreg":
        return {"model__C": loguniform(1e-3, 1e2)}
    if name == "rf":
        return {"model__n_estimators": [200, 300, 500], "model__max_depth": [None, 4, 6, 8],
                "model__min_samples_leaf": [1, 3, 5, 10], "model__class_weight": ["balanced", "balanced_subsample"]}
    common = {"model__n_estimators": randint(200, 801), "model__learning_rate": loguniform(0.01, 0.2),
              "model__subsample": uniform(0.6, 0.4), "model__colsample_bytree": uniform(0.6, 0.4)}
    if name == "lgbm":
        return {**common, "model__num_leaves": [7, 15, 31], "model__min_child_samples": [5, 10, 20]}
    if name == "xgb":
        return {**common, "model__max_depth": [2, 3, 4, 6], "model__min_child_weight": [1, 3, 5]}
    raise ValueError(name)


def tune(name, X, y, scoring, n_iter):
    """TRAIN rows only. Keeps the default params if tuning gains < MIN_GAIN."""
    d = cross_validate(pipeline(name), X, y, cv=tscv(), scoring=scoring, n_jobs=-1)
    rs = RandomizedSearchCV(pipeline(name), space(name), n_iter=n_iter, scoring=scoring, cv=tscv(),
                            random_state=RANDOM_STATE, n_jobs=-1, refit=False)
    rs.fit(X, y)
    t_mean, t_std = rs.best_score_, rs.cv_results_["std_test_score"][rs.best_index_]
    d_mean, d_std = d["test_score"].mean(), d["test_score"].std()
    if t_mean - d_mean < MIN_GAIN:
        return {}, d_mean, d_std
    return to_jsonable(rs.best_params_), t_mean, t_std


def classes_of(level, p90, p95):
    return np.select([level <= p90, level <= p95], [0, 1], 2)


def build(station, df, has_rain):
    tr_end, va_end = split_dates(df)
    p90 = threshold(df.loc[:tr_end, "LEVEL"], 90)
    p95 = threshold(df.loc[:tr_end, "LEVEL"], 95)
    use_snow = snow_usable(df, tr_end)[0]
    F = build_frame(df, p95, use_snow)
    rows = usable_rows(df, "next")
    F = F[rows]
    y = pd.Series(classes_of(df["LEVEL"].shift(-1)[rows].to_numpy(), p90, p95), index=F.index)
    persist = pd.Series(classes_of(df["LEVEL"][rows].to_numpy(), p90, p95), index=F.index)
    split = np.where(F.index <= tr_end, "train", np.where(F.index <= va_end, "val", "test"))
    cols, dropped = drop_constant(feature_sets("next", has_rain, use_snow)["LEAN"], F[split == "train"])
    return dict(X=F[cols], y=y, persist=persist, split=split, cols=cols, p90=p90, p95=p95, dropped=dropped)


def print_counts(station, d):
    print(f"  [{station}] cut-offs (train): p90 LEVEL = {d['p90']:.3f} m, p95 = {d['p95']:.3f} m above gauge datum")
    print(f"  LEAN features ({len(d['cols'])}): {d['cols']}")
    warn = []
    for s in ("train", "val", "test"):
        m = d["split"] == s
        c = np.bincount(d["y"][m], minlength=3)
        idx = d["X"].index[m]
        print(f"    {s:<5} {idx.min().date()} -> {idx.max().date()}  n={m.sum():5d}  "
              f"NORMAL={c[0]}  ELEVATED={c[1]}  HIGH={c[2]}")
        lim = 15 if s == "train" else 8
        warn += [f"{s} {LEVELS[k]}={c[k]} (< {lim})" for k in (1, 2) if c[k] < lim]
    if warn:
        print(f"    !!!!! WARNING: small classes: {', '.join(warn)} !!!!!")
    return warn


def ordinal_proba(p90_model, p95_model, X):
    a = p90_model.predict_proba(X)[:, 1]
    b = np.minimum(p95_model.predict_proba(X)[:, 1], a)
    return np.column_stack([1 - a, a - b, b])


def safety_thresholds(y_val, P_val):
    t2, _ = best_f2_threshold((y_val == 2).astype(int), P_val[:, 2])
    t1, _ = best_f2_threshold((y_val >= 1).astype(int), P_val[:, 1] + P_val[:, 2])
    return t1, t2


def apply_rule(P, rule, t1=None, t2=None):
    if rule == "argmax":
        return P.argmax(axis=1)
    # >= matches best_f2_threshold, which picks t as "predict positive when p >= t"
    return np.where(P[:, 2] >= t2, 2, np.where(P[:, 1] + P[:, 2] >= t1, 1, 0))


def mc_metrics(y, pred):
    y, pred = np.asarray(y), np.asarray(pred)
    cm = confusion_matrix(y, pred, labels=[0, 1, 2])
    prec, rec, _, _ = precision_recall_fscore_support(y, pred, labels=[0, 1, 2], zero_division=0)
    kappa = cohen_kappa_score(y, pred, weights="quadratic") if len(np.unique(pred)) > 1 else 0.0
    out = dict(macro_f1=f1_score(y, pred, average="macro", labels=[0, 1, 2], zero_division=0),
               weighted_f1=f1_score(y, pred, average="weighted", labels=[0, 1, 2], zero_division=0),
               kappa_quadratic=kappa, accuracy=float((y == pred).mean()),
               miss_true2_pred0=int(cm[2, 0]), miss_true0_pred2=int(cm[0, 2]),
               two_class_misses=int(cm[2, 0] + cm[0, 2]), confusion=json.dumps(cm.tolist()))
    for k in range(3):
        out[f"prec_{k}"], out[f"rec_{k}"] = prec[k], rec[k]
    return out


def cv_macro_f1(predict_fold, X, y):
    """predict_fold(train_idx, test_idx) -> class predictions; TimeSeriesSplit on TRAIN rows."""
    s = [f1_score(y.iloc[te], predict_fold(tr, te), average="macro", labels=[0, 1, 2], zero_division=0)
         for tr, te in tscv().split(X)]
    return float(np.mean(s)), float(np.std(s))


def run_station(station, df, has_rain, n_iter):
    t0 = time.time()
    d = build(station, df, has_rain)
    warn = print_counts(station, d)
    X, y, sp = d["X"], d["y"], d["split"]
    Xtr, ytr = X[sp == "train"], y[sp == "train"]
    Xva, yva = X[sp == "val"], y[sp == "val"].to_numpy()
    Xte = X[sp == "test"]

    cands = {}   # name -> dict(P_val, P_test, cv, models)
    for name in MODEL_NAMES:
        params, m, s = tune(name, Xtr, ytr, "f1_macro", n_iter)
        pipe = pipeline(name, params).fit(Xtr, ytr)
        cands[f"direct-{name}"] = dict(P_val=pipe.predict_proba(Xva), P_test=pipe.predict_proba(Xte), cv=(m, s),
                                       models=dict(direct=pipe), params=dict(direct=params), base=name)
        # ordinal: two binary models with the same features
        y90, y95 = (ytr >= 1).astype(int), (ytr == 2).astype(int)
        p90p, _, _ = tune(name, Xtr, y90, "average_precision", n_iter)
        p95p, _, _ = tune(name, Xtr, y95, "average_precision", n_iter)
        m90, m95 = pipeline(name, p90p).fit(Xtr, y90), pipeline(name, p95p).fit(Xtr, y95)

        def fold(tr, te, p90p=p90p, p95p=p95p, name=name):
            a = pipeline(name, p90p).fit(Xtr.iloc[tr], y90.iloc[tr])
            b = pipeline(name, p95p).fit(Xtr.iloc[tr], y95.iloc[tr])
            return ordinal_proba(a, b, Xtr.iloc[te]).argmax(axis=1)

        cands[f"ordinal-{name}"] = dict(P_val=ordinal_proba(m90, m95, Xva), P_test=ordinal_proba(m90, m95, Xte),
                                        cv=cv_macro_f1(fold, Xtr, ytr), models=dict(p90=m90, p95=m95),
                                        params=dict(p90=p90p, p95=p95p), base=name)
        print(f"    {name}: direct CV macro-F1 {m:.3f} +/- {s:.3f} | ordinal CV macro-F1 "
              f"{cands[f'ordinal-{name}']['cv'][0]:.3f} +/- {cands[f'ordinal-{name}']['cv'][1]:.3f}")

    rows = []
    base = dict(station=station, p90=d["p90"], p95=d["p95"])
    for cname, c in cands.items():
        c["t1"], c["t2"] = safety_thresholds(yva, c["P_val"])
        for rule in ("argmax", "safety"):
            for s, P in (("val", c["P_val"]), ("test", c["P_test"])):
                pred = apply_rule(P, rule, c["t1"], c["t2"])
                rows.append(dict(**base, candidate=cname, rule=rule, split=s, cv_macro_f1=c["cv"][0],
                                 cv_macro_f1_std=c["cv"][1], t1=c["t1"] if rule == "safety" else np.nan,
                                 t2=c["t2"] if rule == "safety" else np.nan, **mc_metrics(y[sp == s], pred)))
    pers_cv = cv_macro_f1(lambda tr, te: d["persist"][sp == "train"].iloc[te].to_numpy(), Xtr, ytr)
    zero_cv = cv_macro_f1(lambda tr, te: np.zeros(len(te), int), Xtr, ytr)
    for cname, pred_all, cv in (("persistence", d["persist"], pers_cv), ("always_0", d["persist"] * 0, zero_cv)):
        for s in ("val", "test"):
            rows.append(dict(**base, candidate=cname, rule="-", split=s, cv_macro_f1=cv[0], cv_macro_f1_std=cv[1],
                             **mc_metrics(y[sp == s], pred_all[sp == s])))
    table = pd.DataFrame(rows)

    v = table[(table.split == "val") & (table.rule == "argmax")].copy()
    v["s"] = v.candidate.map(lambda c: SIMPLE[c.split("-")[1]] + (0.5 if c.startswith("ordinal") else 0))
    tied = v[v.macro_f1 >= v.macro_f1.max() - 0.01].sort_values(["s", "macro_f1"], ascending=[True, False])
    best = tied.iloc[0].candidate
    print(f"    best candidate on VALIDATION macro-F1 (ties within 0.01 -> simpler): {best}; time {time.time() - t0:.0f}s")
    return d, cands, table, best, warn


# ------------------------------------------------------------- reporting

def print_table(station, table):
    t = table.copy()
    t["cv"] = t.cv_macro_f1.round(3).astype(str) + "+/-" + t.cv_macro_f1_std.round(3).astype(str)
    cols = ["candidate", "rule", "macro_f1", "weighted_f1", "kappa_quadratic", "prec_1", "rec_1", "prec_2", "rec_2",
            "miss_true2_pred0", "miss_true0_pred2", "confusion", "cv"]
    for s in ("val", "test"):
        print(f"\n  ===== {station} multiclass, {s.upper()} (per-class: 1 = ELEVATED, 2 = HIGH) =====")
        with pd.option_context("display.width", 260, "display.max_columns", 30):
            print(t[t.split == s][cols].round(3).to_string(index=False))
    print("  NOTE: few ELEVATED/HIGH days in val/test; differences of a few hundredths are within noise "
          "(compare with the CV std).")


def collapse_check(station, d, cands, best):
    """Merge predicted 1+2 into 'alert' (vs LEVEL > p90) and also check class 2 alone (vs LEVEL > p95),
    against binary models at the same thresholds."""
    sp, y = d["split"], d["y"]
    rows = []

    def add(label, thr_name, split, truth, pred):
        idx = d["X"].index[sp == split]
        n_ev, caught, before = events(idx, truth, pred, "next")
        rows.append(dict(station=station, threshold=thr_name, model=label, split=split,
                         precision=precision_score(truth, pred, zero_division=0),
                         recall=recall_score(truth, pred, zero_division=0), alerts=int(pred.sum()),
                         events=n_ev, events_caught=caught, fired_day_before=before))

    c = cands[best]
    # existing shipped binary model: v2 NEXT-DAY p95 (same rows, same LEAN features)
    b95 = joblib.load(MODELS_DIR / "v2" / f"best_{station}_next_p95.joblib")
    if b95["features"] != d["cols"]:
        raise SystemExit(f"{station}: v2 binary p95 features differ from the multiclass LEAN set")
    if abs(b95["level_threshold"] - d["p95"]) > 1e-9:
        raise SystemExit(f"{station}: v2 binary p95 threshold {b95['level_threshold']} != multiclass p95 {d['p95']}")
    # binary p90 reference: the ordinal P(L>p90) model of the same family, F2 cut-off on validation
    m90 = cands[f"ordinal-{c['base']}"]["models"]["p90"]
    Xva = d["X"][sp == "val"]
    cut90, _ = best_f2_threshold((y[sp == "val"] >= 1).astype(int).to_numpy(), m90.predict_proba(Xva)[:, 1])
    for split, P in (("val", c["P_val"]), ("test", c["P_test"])):
        Xs = d["X"][sp == split]
        t2 = (y[sp == split] == 2).astype(int).to_numpy()
        t1 = (y[sp == split] >= 1).astype(int).to_numpy()
        for rule in ("argmax", "safety"):
            pr = apply_rule(P, rule, c["t1"], c["t2"])
            add(f"{best} [{rule}] HIGH", "p95", split, t2, (pr == 2).astype(int))
            add(f"{best} [{rule}] ELEVATED+HIGH", "p90", split, t1, (pr >= 1).astype(int))
        add(f"binary v2 {b95['model']} (shipped p95)", "p95", split, t2,
            (b95["pipeline"].predict_proba(Xs)[:, 1] >= b95["cutoff"]).astype(int))
        add(f"binary p90 {c['base']} (ordinal sub-model, F2 cut-off)", "p90", split, t1,
            (m90.predict_proba(Xs)[:, 1] >= cut90).astype(int))
        pers = d["persist"][sp == split].to_numpy()
        add("persistence", "p95", split, t2, (pers == 2).astype(int))
        add("persistence", "p90", split, t1, (pers >= 1).astype(int))
    return pd.DataFrame(rows)


def plot_cms(station, d, cands, table, best):
    sp, y = d["split"], d["y"][d["split"] == "test"].to_numpy()
    panels = [(n, "argmax", cands[n]["P_test"]) for n in cands] + [(best, "safety", cands[best]["P_test"])]
    fig, axes = plt.subplots(2, 5, figsize=(17, 8.2))
    for ax, (n, rule, P) in zip(axes.ravel(), panels + [("persistence", "-", None)]):
        pred = d["persist"][sp == "test"].to_numpy() if P is None else apply_rule(P, rule, cands[n]["t1"], cands[n]["t2"])
        cm = confusion_matrix(y, pred, labels=[0, 1, 2])
        norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
        ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
        for i in range(3):
            for j in range(3):
                ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=10,
                        color="white" if norm[i, j] > 0.5 else "#0b0b0b")
        ax.set_xticks(range(3), ["N", "E", "H"], fontsize=8)
        ax.set_yticks(range(3), ["N", "E", "H"], fontsize=8)
        ax.set_xlabel("predicted", fontsize=8)
        ax.set_ylabel("true", fontsize=8)
        ax.set_title(f"{n}\n{rule}" + ("  (best)" if n == best else ""), fontsize=9)
    fig.suptitle(f"{station} - TEST 3x3 confusion matrices (colour = row share; N/E/H = NORMAL/ELEVATED/HIGH)",
                 fontsize=11)
    fig.tight_layout(h_pad=2.5)
    fig.savefig(OUT / f"{station}_confusion_3class.png", dpi=110)
    plt.close(fig)


def importances(station, d, cands, table):
    v = table[(table.split == "val") & (table.rule == "argmax") & table.candidate.isin(
        [f"direct-{n}" for n in ("rf", "lgbm", "xgb")])]
    name = v.sort_values("macro_f1", ascending=False).iloc[0].candidate
    m = cands[name]["models"]["direct"].named_steps["model"]
    vals = m.booster_.feature_importance(importance_type="gain") if name.endswith("lgbm") else m.feature_importances_
    s = pd.Series(vals, index=d["cols"], dtype=float)
    s = (s / s.sum()).sort_values(ascending=False).head(15)
    s.rename("share").to_csv(OUT / f"importance_{station}_{name}.csv")
    print(f"    top-{len(s)} importances, best direct tree model on validation ({name}): "
          + ", ".join(f"{k}={v:.3f}" for k, v in s.items()))


def run(cleaned, has_rain, n_iter):
    OUT.mkdir(parents=True, exist_ok=True)
    (MODELS_DIR / "multiclass").mkdir(parents=True, exist_ok=True)
    print("\n=== MULTICLASS (NEXT-DAY): NORMAL <= p90 < ELEVATED <= p95 < HIGH ===")
    tables, collapses, warns, t_all = [], [], {}, time.time()
    for station in STATIONS:
        print(f"\n################ multiclass {station} ################")
        d, cands, table, best, warn = run_station(station, cleaned[station], has_rain, n_iter)
        warns[station] = warn
        print_table(station, table)
        importances(station, d, cands, table)
        plot_cms(station, d, cands, table, best)
        cc = collapse_check(station, d, cands, best)
        print(f"\n  Collapse check {station} (TEST): does multiclass lose anything on the binary task?")
        with pd.option_context("display.width", 220):
            print(cc[cc.split == "test"].drop(columns=["station", "split"]).round(3).to_string(index=False))
        tables.append(table)
        collapses.append(cc)
        c = cands[best]
        joblib.dump(dict(kind="ordinal" if best.startswith("ordinal") else "direct", models=c["models"],
                         candidate=best, features=d["cols"], p90=d["p90"], p95=d["p95"], t1=c["t1"], t2=c["t2"],
                         station=station, params=c["params"]),
                    MODELS_DIR / "multiclass" / f"best_{station}.joblib")
        print(f"  saved models/multiclass/best_{station}.joblib ({best}; safety t1={c['t1']:.4f}, t2={c['t2']:.4f})")
    pd.concat(tables).to_csv(RESULTS_DIR / "multiclass_comparison.csv", index=False)
    pd.concat(collapses).to_csv(RESULTS_DIR / "multiclass_collapse_check.csv", index=False)
    print(f"\nSmall-class warnings: {warns}")
    print(f"multiclass done in {time.time() - t_all:.0f}s -> results/multiclass_comparison.csv, "
          f"results/multiclass_collapse_check.csv, results/multiclass/, models/multiclass/")


def proba3(bundle, X):
    """3-class probabilities for a saved bundle (used by predict.py)."""
    if bundle["kind"] == "direct":
        return bundle["models"]["direct"].predict_proba(X)
    return ordinal_proba(bundle["models"]["p90"], bundle["models"]["p95"], X)
