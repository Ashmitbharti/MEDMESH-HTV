"""Model A training and evaluation, same process as FloodSense: split -> tune on TRAIN -> thresholds on
VALIDATION -> TEST once -> importances -> winner -> overfitting checks -> save.

python train.py                   # 110-row coverage set (data/coverage.csv) -> results/coverage/, models/
python train.py --data big        # big simulated set (data/big.csv)       -> results/big/, models/big/
"""
import argparse
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
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, fbeta_score, precision_recall_curve, precision_score, recall_score,
                             roc_auc_score)
from sklearn.model_selection import GroupKFold, RandomizedSearchCV, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from common import (DATA_DIR, FAILURE_SCENARIOS, FEATURES, HARD_NEGATIVES, HORIZON, LABEL, MODELS_DIR, RANDOM_STATE,
                    RESULTS_DIR, SCENARIOS)

warnings.filterwarnings("ignore", message=".*No positive class found in y_true.*")
warnings.filterwarnings("ignore", message=".*Only one class is present in y_true.*")
warnings.filterwarnings("ignore", category=UserWarning, message=".*feature names.*")

MODEL_NAMES = ["logreg", "rf", "lgbm"]
BASELINES = ["snr_rule", "silence_rule", "always_no"]
SIMPLICITY = {"always_no": 0, "snr_rule": 1, "silence_rule": 1, "logreg": 2, "rf": 3, "lgbm": 4}
MIN_GAIN = 0.01
COLORS = {"logreg": "#2a78d6", "rf": "#eb6834", "lgbm": "#1baf7a",
          "snr_rule": "#0b0b0b", "silence_rule": "#6b6a64", "always_no": "#b5b4ad"}


# ---------------------------------------------------------------- models
def make_pipeline(name, mode, params=None):
    imp = ("impute", SimpleImputer(strategy="median"))
    if name == "logreg":       # strong L2 regularisation
        steps = [imp, ("scale", StandardScaler()),
                 ("model", LogisticRegression(C=0.1, class_weight="balanced", solver="saga", l1_ratio=0.0,
                                              max_iter=5000, random_state=RANDOM_STATE))]
    elif name == "rf":         # small, shallow forest
        steps = [imp, ("model", RandomForestClassifier(n_estimators=200, max_depth=3, min_samples_leaf=3,
                                                       class_weight="balanced", random_state=RANDOM_STATE,
                                                       n_jobs=1))]
    elif name == "lgbm":       # small trees, many samples per leaf
        steps = [imp, ("model", LGBMClassifier(n_estimators=100, learning_rate=0.05, num_leaves=4, max_depth=2,
                                               min_child_samples=10 if mode == "coverage" else 50,
                                               reg_lambda=1.0, random_state=RANDOM_STATE, n_jobs=1,
                                               verbose=-1))]
    else:
        raise ValueError(name)
    pipe = Pipeline(steps)
    if params:
        pipe.set_params(**params)
    return pipe


def search_space(name, mode):
    if name == "logreg":
        # wider search (asked for): strength, L2 <-> L1 mix, class weighting
        return {"model__C": loguniform(1e-4, 1e2), "model__l1_ratio": [0.0, 0.25, 0.5, 0.75, 1.0],
                "model__class_weight": [None, "balanced"]}
    if name == "rf":
        return {"model__n_estimators": [100, 200, 300], "model__max_depth": [3, 4],
                "model__min_samples_leaf": [2, 3, 5, 8], "model__max_features": ["sqrt", 0.5]}
    mcs = [8, 10, 15] if mode == "coverage" else [30, 50, 100]
    return {"model__n_estimators": randint(50, 301), "model__learning_rate": loguniform(0.02, 0.2),
            "model__num_leaves": [3, 4, 7], "model__max_depth": [2, 3], "model__min_child_samples": mcs,
            "model__reg_lambda": loguniform(1e-2, 10), "model__subsample": uniform(0.7, 0.3),
            "model__subsample_freq": [1], "model__colsample_bytree": uniform(0.6, 0.4)}


def baseline_score(name, X):
    """Higher = more alarming. snr_rule: 'max SNR over the last 30 s below X' (no packet in 30 s counts as
    below); silence_rule: seconds since the last packet."""
    if name == "snr_rule":
        return (-X["snr_max_30s"]).fillna(1e3).to_numpy()
    if name == "silence_rule":
        return X["seconds_since_last_packet"].fillna(1e3).to_numpy()
    return np.zeros(len(X))


def gkf(n=5):
    return GroupKFold(n_splits=n, shuffle=True, random_state=RANDOM_STATE)


def to_jsonable(p):
    return {k: (v.item() if isinstance(v, np.generic) else v) for k, v in p.items()}


# ---------------------------------------------------------------- splits
def split_sessions(df, mode):
    """Coverage: within each scenario, sessions with and without positives are each split 60/20/20, so every
    scenario appears in every split. Big: whole sessions 60/20/20."""
    rng = np.random.default_rng(RANDOM_STATE)
    split = {}
    if mode == "coverage":
        sess = df.groupby(["scenario", "session_id"])[LABEL].max().reset_index()
        for (_, _), g in sess.groupby(["scenario", LABEL]):
            ids = list(rng.permutation(g.session_id.to_numpy()))
            n = len(ids)
            n_tr, n_va = round(0.6 * n), round(0.2 * n)
            for i, s in enumerate(ids):
                split[s] = "train" if i < n_tr else "val" if i < n_tr + n_va else "test"
    else:
        ids = list(rng.permutation(sorted(df.session_id.unique())))
        n = len(ids)
        n_tr, n_va = round(0.6 * n), round(0.2 * n)
        for i, s in enumerate(ids):
            split[s] = "train" if i < n_tr else "val" if i < n_tr + n_va else "test"
    return df.session_id.map(split)


def print_split(df):
    for sp in ("train", "val", "test"):
        d = df[df.split == sp]
        print(f"  {sp.upper():5s}: {len(d):5d} rows, {d.session_id.nunique():3d} sessions, "
              f"{int(d[LABEL].sum())} positives ({d[LABEL].mean():.1%})")
        print("         sessions: " + ", ".join(sorted(d.session_id.unique())))
    t = df.pivot_table(index="scenario", columns="split", values=LABEL, aggfunc=["size", "sum"], fill_value=0)
    t.columns = [f"{'rows' if a == 'size' else 'pos'}_{b}" for a, b in t.columns]
    t = t.reindex([s for s in SCENARIOS if s in t.index])
    print("  rows / positives per scenario and split:")
    print(t[[c for c in ("rows_train", "pos_train", "rows_val", "pos_val", "rows_test", "pos_test")
             if c in t.columns]].to_string())


# ---------------------------------------------------------------- thresholds and metrics
def best_fbeta(y, p, beta, cands=None):
    cands = np.unique(p) if cands is None else cands
    best_t, best_f = (float(cands.max()) if len(cands) else 0.5), -1.0
    for t in cands:
        f = fbeta_score(y, (p >= t).astype(int), beta=beta, zero_division=0)
        if f >= best_f:                      # ties -> higher threshold (fewer alarms)
            best_t, best_f = float(t), f
    return best_t, best_f


def choose_thresholds(y, p):
    """WATCH = F2-optimal on validation. WARNING = lowest threshold >= WATCH with precision >= 0.5 on
    validation (and at least one hit); if none, the F0.5-optimal threshold >= WATCH."""
    watch, _ = best_fbeta(y, p, 2)
    cands = np.unique(p[p >= watch])
    for t in cands:
        pred = p >= t
        if pred.sum() and y[pred].sum() and precision_score(y, pred.astype(int)) >= 0.5:
            return watch, float(t), "lowest threshold with val precision >= 0.5"
    warn, _ = best_fbeta(y, p, 0.5, cands)
    return watch, warn, "no threshold reached val precision 0.5 -> F0.5-optimal"


def best_accuracy(y, p):
    """Threshold that maximises VALIDATION accuracy (ties -> higher threshold)."""
    best_t, best_a = 0.5, -1.0
    for t in np.unique(np.r_[p, np.inf]):
        acc = ((p >= t).astype(int) == y).mean()
        if acc >= best_a:
            best_t, best_a = float(t), acc
    return best_t


def events(d, pred):
    """Failure events = distinct (session, node, failure time) among positive rows. Caught = at least one
    positive row of that event alarmed; lead time = earliest such alarm before the failure."""
    pos = d[LABEL].to_numpy() == 1
    if not pos.any():
        return 0, 0, np.nan
    ft = (d.t_seconds + d.time_to_failure_s).round(1)
    ev = pd.DataFrame({"k": d.session_id + "|" + d.node_id + "|" + ft.astype(str), "ttf": d.time_to_failure_s,
                       "a": pred})[pos]
    caught = ev[ev.a == 1].groupby("k").ttf.max()
    return ev.k.nunique(), len(caught), float(caught.median()) if len(caught) else np.nan


def metrics(d, p, thr, binary_brier=False):
    y = d[LABEL].to_numpy()
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    n_ev, caught, lead = events(d, pred)
    return dict(precision=precision_score(y, pred, zero_division=0), recall=recall_score(y, pred, zero_division=0),
                f1=f1_score(y, pred, zero_division=0), f2=fbeta_score(y, pred, beta=2, zero_division=0),
                pr_auc=average_precision_score(y, p) if y.sum() else np.nan,
                roc_auc=roc_auc_score(y, p) if 0 < y.sum() < len(y) else np.nan,
                brier=brier_score_loss(y, pred if binary_brier else np.clip(p, 0, 1)),
                accuracy=accuracy_score(y, pred), tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp),
                events=n_ev, events_caught=caught, median_lead_s=lead)


def score(name, mode, params, Xtr, ytr, Xte):
    if name in BASELINES:
        return baseline_score(name, Xte)
    return make_pipeline(name, mode, params).fit(Xtr[FEATURES], ytr).predict_proba(Xte[FEATURES])[:, 1]


def cv_train(name, mode, params, tr, watch):
    """GroupKFold by session on TRAIN: PR-AUC and F2 at the validation WATCH threshold, mean and std."""
    ap, f2 = [], []
    for a, b in gkf().split(tr, tr[LABEL], tr.session_id):
        p = score(name, mode, params, tr.iloc[a], tr[LABEL].iloc[a], tr.iloc[b])
        y = tr[LABEL].iloc[b].to_numpy()
        if y.sum():
            ap.append(average_precision_score(y, p))
        f2.append(fbeta_score(y, (p >= watch).astype(int), beta=2, zero_division=0))
    return np.mean(ap), np.std(ap), np.mean(f2), np.std(f2)


# ---------------------------------------------------------------- steps
def tune(tr, mode, n_iter, out, n_iter_logreg=60):
    X, y, g = tr[FEATURES], tr[LABEL], tr.session_id
    fold_pos = [int(y.iloc[b].sum()) for _, b in gkf().split(X, y, g)]
    print(f"  tuning on TRAIN only: {len(y)} rows, {int(y.sum())} positives, {g.nunique()} sessions; "
          f"GroupKFold(5) by session, test-fold positives {fold_pos}; n_iter={n_iter}")
    print(f"  logistic regression gets a wider search: n_iter={n_iter_logreg} over C in [1e-4, 100], l1_ratio "
          "(L2..L1) and class_weight")
    print("  NOTE: with this little data the CV score of each candidate is noisy, so picking the best of "
          f"{n_iter} candidates mostly fits noise. A tuned set is kept only if it gains >= {MIN_GAIN} CV PR-AUC.")
    rows, best = [], {}
    for name in MODEL_NAMES:
        d = cross_validate(make_pipeline(name, mode), X, y, groups=g, cv=gkf(), scoring="average_precision")
        rs = RandomizedSearchCV(make_pipeline(name, mode), search_space(name, mode),
                                n_iter=n_iter_logreg if name == "logreg" else n_iter,
                                scoring="average_precision", cv=gkf(), random_state=RANDOM_STATE, refit=False)
        rs.fit(X, y, groups=g)
        res = pd.DataFrame(rs.cv_results_)
        res.to_csv(out / f"tuning_results_{name}.csv", index=False)
        d_m, d_s = d["test_score"].mean(), d["test_score"].std()
        t_m, t_s = rs.best_score_, res["std_test_score"][rs.best_index_]
        keep_default = (t_m - d_m) < MIN_GAIN
        best[name] = {} if keep_default else to_jsonable(rs.best_params_)
        rows.append(dict(model=name, default_cv_pr_auc=d_m, default_std=d_s, tuned_cv_pr_auc=t_m, tuned_std=t_s,
                         gain=t_m - d_m, gain_vs_tuned_std=(t_m - d_m) / t_s if t_s else np.nan,
                         kept="default" if keep_default else "tuned"))
    tab = pd.DataFrame(rows)
    tab.to_csv(out / "default_vs_tuned.csv", index=False)
    print(tab.round(4).to_string(index=False))
    print("  (gain_vs_tuned_std < 1 means the gain is smaller than the fold-to-fold spread of the winner itself)")
    return tab, best


def plot_pr(df, scores, out, tag):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), sharey=True)
    for ax, sp in zip(axes, ("val", "test")):
        y = df[df.split == sp][LABEL].to_numpy()
        for name in MODEL_NAMES + ["snr_rule", "silence_rule"]:
            p = scores[(name, sp)]
            pr, rc, _ = precision_recall_curve(y, p)
            ax.plot(rc, pr, lw=2 if name in MODEL_NAMES else 1.3, color=COLORS[name],
                    ls="-" if name in MODEL_NAMES else "--",
                    label=f"{name} (AP {average_precision_score(y, p):.3f})")
        ax.axhline(y.mean(), color="#c3c2b7", lw=1, ls=":", label=f"prevalence {y.mean():.3f}")
        ax.set_title(f"{sp.upper()} ({int(y.sum())} positives / {len(y)} rows)", fontsize=10)
        ax.set_xlabel("recall")
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].set_ylabel("precision")
    axes[1].legend(fontsize=8, loc="upper right", frameon=False)
    fig.suptitle(f"Model A link health ({tag}, SIMULATED) - precision/recall", fontsize=11)
    fig.tight_layout()
    fig.savefig(out / "pr_curves.png", dpi=120)
    plt.close(fig)


def plot_confusion(test_rows, out, tag):
    fig, axes = plt.subplots(1, len(test_rows), figsize=(2.9 * len(test_rows), 3.1))
    for ax, (_, r) in zip(axes, test_rows.iterrows()):
        m = np.array([[r.tn, r.fp], [r.fn, r.tp]])
        vmax = max(1, m.sum() * 0.7)
        ax.imshow(m, cmap="Blues", vmin=0, vmax=vmax)
        for i in range(2):
            for j in range(2):
                ax.text(j, i, str(m[i, j]), ha="center", va="center", fontsize=12,
                        color="white" if m[i, j] > 0.5 * vmax else "#0b0b0b")
        ax.set_xticks([0, 1], ["pred 0", "pred 1"])
        ax.set_yticks([0, 1], ["true 0", "true 1"])
        ax.set_title(r.model, fontsize=10)
    fig.suptitle(f"TEST confusion matrices at WATCH ({tag}, thresholds fixed on validation)", fontsize=11)
    fig.tight_layout()
    fig.savefig(out / "confusion_matrices_test.png", dpi=120)
    plt.close(fig)


def importances(fitted, out):
    shares = {}
    for name in ("rf", "lgbm"):
        m = fitted[name].named_steps["model"]
        vals = m.booster_.feature_importance(importance_type="gain") if name == "lgbm" else m.feature_importances_
        s = pd.Series(vals, index=FEATURES, dtype=float)
        s = (s / s.sum() if s.sum() else s).sort_values(ascending=False)
        s.rename("share").to_csv(out / f"feature_importance_{name}.csv")
        shares[name] = s
        kind = "gain" if name == "lgbm" else "impurity decrease"
        print(f"  {name} importance ({kind}, share): " + ", ".join(f"{k}={v:.2f}" for k, v in s.items() if v > 0))
    lr = fitted["logreg"].named_steps["model"]
    coef = pd.Series(lr.coef_[0], index=FEATURES).sort_values(key=np.abs, ascending=False)
    coef.rename("coef_per_std").to_csv(out / "logreg_coefficients.csv")
    print("  logreg coefficients (per 1 std of the feature, + = more risk): "
          + ", ".join(f"{k}={v:+.2f}" for k, v in coef.items()))
    return shares, coef


def per_scenario(d, p, watch, warn):
    rows = []
    for sc in [s for s in SCENARIOS if s in set(d.scenario)]:
        m = d.scenario == sc
        y, pp = d[LABEL].to_numpy()[m], p[m]
        pos, neg = y == 1, y == 0
        rows.append(dict(scenario=sc, kind="failure" if sc in FAILURE_SCENARIOS else
                         "hard negative" if sc in HARD_NEGATIVES else "baseline",
                         positives=int(pos.sum()), negatives=int(neg.sum()),
                         recall_watch=(pp[pos] >= watch).mean() if pos.any() else np.nan,
                         recall_warning=(pp[pos] >= warn).mean() if pos.any() else np.nan,
                         false_alarm_rate_watch=(pp[neg] >= watch).mean() if neg.any() else np.nan,
                         false_alarm_rate_warning=(pp[neg] >= warn).mean() if neg.any() else np.nan))
    return pd.DataFrame(rows)


def say_failures(tab, who):
    bad_r = tab[(tab.positives > 0) & ((tab.recall_watch < 0.5) | (tab.recall_warning < 0.5))]
    bad_f = tab[(tab.negatives > 0) & (tab.false_alarm_rate_watch > 0)]
    for _, r in bad_r.iterrows():
        lv = "WATCH" if r.recall_watch < 0.5 else "WARNING"
        print(f"    FAILS ({who}): {r.scenario}: recall {r.recall_watch:.2f} at WATCH, {r.recall_warning:.2f} at "
              f"WARNING ({r.positives} positive rows) - most of the lead-up is missed at {lv}.")
    for _, r in bad_f.iterrows():
        tag = "HARD NEGATIVE " if r.kind == "hard negative" else ""
        print(f"    FALSE ALARMS ({who}): {tag}{r.scenario}: {r.false_alarm_rate_watch:.0%} of its "
              f"{r.negatives} negative rows alarm at WATCH, {r.false_alarm_rate_warning:.0%} at WARNING.")
    if not len(bad_r) and not len(bad_f):
        print(f"    ({who}): every scenario has recall >= 0.5 and no false alarms at WATCH.")


def oof(df, name, mode, params, group_col):
    p = np.full(len(df), np.nan)
    for g in df[group_col].unique():
        te = (df[group_col] == g).to_numpy()
        tr = df[~te]
        if name not in BASELINES and tr[LABEL].nunique() < 2:
            continue
        p[te] = score(name, mode, params, tr, tr[LABEL], df[te])
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", choices=["coverage", "big"], default="coverage")
    ap.add_argument("--n-iter", type=int, default=15)
    ap.add_argument("--n-iter-logreg", type=int, default=60)
    ap.add_argument("--shuffles", type=int, default=10, help="repeats of the shuffled-label test")
    a = ap.parse_args()
    mode = a.data
    t_start = time.time()
    out = RESULTS_DIR / mode
    out.mkdir(parents=True, exist_ok=True)
    mdir = MODELS_DIR if mode == "coverage" else MODELS_DIR / "big"
    mdir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(DATA_DIR / f"{mode}.csv", dtype={"node_id": str})
    print(f"=== Model A (link health), dataset {mode}: {len(df)} rows, {df.session_id.nunique()} sessions, "
          f"{int(df[LABEL].sum())} positives ({df[LABEL].mean():.1%}); is_simulated all 1: "
          f"{bool((df.is_simulated == 1).all())} ===")

    print("\n=== STEP 1: split by session" + (" (stratified by scenario type)" if mode == "coverage" else "")
          + " ===")
    df["split"] = split_sessions(df, mode)
    assert df.groupby("session_id").split.nunique().max() == 1, "a session is in two splits"
    print_split(df)
    df[["session_id", "scenario", "split"]].drop_duplicates().sort_values(["split", "session_id"]).to_csv(
        out / "split_sessions.csv", index=False)
    tr, va, te = (df[df.split == s].reset_index(drop=True) for s in ("train", "val", "test"))
    df_s = pd.concat([tr, va, te], ignore_index=True)

    print("\n=== STEP 2: tuning (TRAIN only) ===")
    tab, best = tune(tr, mode, a.n_iter, out, a.n_iter_logreg)
    (out / "best_params.json").write_text(json.dumps(best, indent=2))

    print("\n=== STEP 3: fit on TRAIN, thresholds on VALIDATION ===")
    fitted, scores, thr = {}, {}, {}
    for name in MODEL_NAMES:
        fitted[name] = make_pipeline(name, mode, best[name] or None).fit(tr[FEATURES], tr[LABEL])
        for sp, d in (("train", tr), ("val", va), ("test", te)):
            scores[(name, sp)] = fitted[name].predict_proba(d[FEATURES])[:, 1]
    for name in BASELINES:
        for sp, d in (("train", tr), ("val", va), ("test", te)):
            scores[(name, sp)] = baseline_score(name, d)
    for name in MODEL_NAMES + BASELINES:
        if name == "always_no":
            thr[name] = (0.5, 0.5, "never alarms")
            continue
        thr[name] = choose_thresholds(va[LABEL].to_numpy(), scores[(name, "val")])
        w, wa, rule = thr[name]
        if name == "snr_rule":
            fmt = lambda t: "no packet in 30 s" if t >= 1e3 else f"max SNR(30 s) < {-t:.2f} dB"
            print(f"  snr_rule: WATCH = {fmt(w)}, WARNING = {fmt(wa)} ({rule})")
        elif name == "silence_rule":
            print(f"  silence_rule: WATCH = seconds_since_last_packet >= {w:.1f}, WARNING >= {wa:.1f} ({rule})")
        else:
            print(f"  {name}: WATCH = {w:.4f} (F2-optimal on val), WARNING = {wa:.4f} ({rule})")

    acc_thr = {n: best_accuracy(va[LABEL].to_numpy(), scores[(n, "val")]) for n in MODEL_NAMES + BASELINES}
    for n in MODEL_NAMES:
        print(f"  {n}: ACCURACY-optimal threshold on val = {acc_thr[n]:.4f}")

    print("\n=== STEP 4: VALIDATION and TEST (TEST scored once, thresholds fixed) ===")
    rows = []
    for name in MODEL_NAMES + BASELINES:
        params = best.get(name) or None
        w, wa, _ = thr[name]
        cv = cv_train(name, mode, params, tr, w)
        for sp, d in (("val", va), ("test", te)):
            for level, t in (("WATCH", w), ("WARNING", wa), ("ACCURACY", acc_thr[name])):
                rows.append(dict(model=name, split=sp, level=level, threshold=t,
                                 **metrics(d, scores[(name, sp)], t, binary_brier=name in BASELINES),
                                 cv_pr_auc=cv[0], cv_pr_auc_std=cv[1], cv_f2_watch=cv[2], cv_f2_watch_std=cv[3]))
    table = pd.DataFrame(rows)
    table.to_csv(out / "model_comparison.csv", index=False)
    t = table.copy()
    t["cv_pr_auc"] = t.apply(lambda r: f"{r.cv_pr_auc:.3f}+/-{r.cv_pr_auc_std:.3f}", axis=1)
    t["events"] = t.apply(lambda r: f"{r.events_caught}/{r.events}", axis=1)
    cols = ["model", "precision", "recall", "f1", "f2", "pr_auc", "roc_auc", "brier", "accuracy",
            "tn", "fp", "fn", "tp", "events", "median_lead_s", "cv_pr_auc"]
    for sp in ("val", "test"):
        for level in ("WATCH", "WARNING", "ACCURACY"):
            print(f"  --- {sp.upper()} at {level} (ranked by PR-AUC; accuracy shown, not used) ---")
            print(t[(t.split == sp) & (t.level == level)][cols].sort_values("pr_auc", ascending=False)
                  .round(3).to_string(index=False))
    print("  NOTE: baselines' Brier is computed on their 0/1 alarm (they output no probability). CV = GroupKFold(5)"
          " by session on TRAIN. Lead time = earliest alarm before the failure, per caught failure event.")
    for sp, d in (("val", va), ("test", te)):
        p_ = d[LABEL].mean()
        print(f"  REFERENCE: 'always alarm' on {sp.upper()} has precision {p_:.3f}, recall 1, F2 {5 * p_ / (4 * p_ + 1):.3f}")
    for name in MODEL_NAMES:
        neg = va[LABEL].to_numpy() == 0
        fr = (scores[(name, "val")][neg] >= thr[name][0]).mean()
        if fr > 0.5:
            print(f"  WARNING: {name}'s F2-optimal WATCH alarms on {fr:.0%} of VALIDATION negatives. At this base rate "
                  "F2 rewards alarming on nearly everything, so WATCH is close to 'always alarm'; WARNING is the "
                  "usable level.")
    print(f"  NOTE: TEST has {int(te[LABEL].sum())} positive rows; one row more or less caught moves recall by "
          f"{1 / max(1, te[LABEL].sum()):.2f}.")
    plot_pr(df_s, scores, out, mode)
    plot_confusion(table[(table.split == "test") & (table.level == "WATCH")], out, mode)

    print("\n=== STEP 5: feature importances and coefficients ===")
    importances(fitted, out)

    print("\n=== STEP 6: winner (validation PR-AUC; within 0.01 -> F2 at WATCH; within 0.01 -> simpler) ===")
    v = table[(table.split == "val") & (table.level == "WATCH") & table.model.isin(MODEL_NAMES)].copy()
    tied = v[v.pr_auc >= v.pr_auc.max() - 0.01]
    tied = tied[tied.f2 >= tied.f2.max() - 0.01]
    winner = tied.assign(s=tied.model.map(SIMPLICITY)).sort_values(["s", "pr_auc"], ascending=[True, False]) \
        .iloc[0]["model"]
    for _, r in v.sort_values("pr_auc", ascending=False).iterrows():
        print(f"  {r.model:7s} val PR-AUC {r.pr_auc:.3f}  F2@WATCH {r.f2:.3f}  train-CV PR-AUC "
              f"{r.cv_pr_auc:.3f} +/- {r.cv_pr_auc_std:.3f}")
    print(f"  WINNER: {winner}. Validation has {int(va[LABEL].sum())} positives: differences of a few hundredths "
          "are within noise.")
    wt = table[(table.model == winner) & (table.split == "test")].set_index("level")
    for lv in ("WATCH", "WARNING", "ACCURACY"):
        r = wt.loc[lv]
        print(f"  {winner} on TEST at {lv}: precision {r.precision:.3f}, recall {r.recall:.3f}, F2 {r.f2:.3f}, "
              f"PR-AUC {r.pr_auc:.3f}, false alarms {r.fp}/{r.fp + r.tn}, events caught "
              f"{r.events_caught}/{r.events}, median lead {r.median_lead_s:.0f} s, accuracy {r.accuracy:.3f}")
    base_t = table[(table.split == "test") & (table.level == "WATCH") & table.model.isin(BASELINES)]
    for _, r in base_t.iterrows():
        print(f"  baseline {r.model:12s} on TEST at WATCH: precision {r.precision:.3f}, recall {r.recall:.3f}, "
              f"F2 {r.f2:.3f}, PR-AUC {r.pr_auc:.3f}")

    print("\n=== STEP 7: per-scenario recall and false-alarm rate ===")
    w, wa, _ = thr[winner]
    ps_test = pd.concat([per_scenario(te, scores[(n, "test")], *thr[n][:2]).assign(model=n)
                         for n in MODEL_NAMES + BASELINES])
    ps_test.to_csv(out / "per_scenario_test.csv", index=False)
    print(f"  (a) TEST split, {winner}, fixed thresholds:")
    print(ps_test[ps_test.model == winner].drop(columns="model").round(2).to_string(index=False))
    say_failures(ps_test[ps_test.model == winner], "TEST")
    te_x = te[te.scenario != "hard_unplug"]
    r = metrics(te_x, scores[(winner, "test")][(te.scenario != "hard_unplug").to_numpy()], w)
    print(f"  TEST without hard_unplug rows (unpredictable from signal): recall {r['recall']:.3f}, precision "
          f"{r['precision']:.3f}, PR-AUC {r['pr_auc']:.3f}")

    print(f"\n  (b) leave-one-SESSION-out, out-of-fold predictions for every row (all splits; params fixed from "
          f"train tuning, thresholds fixed from validation; diagnostic only, nothing is chosen here):")
    loss_rows, ps_loss, oof_scores = [], [], {}
    for name in MODEL_NAMES + BASELINES:
        p = oof(df_s, name, mode, best.get(name) or None, "session_id")
        oof_scores[name] = p
        nw, nwa, _ = thr[name]
        m = metrics(df_s, p, nw, binary_brier=name in BASELINES)
        per = [average_precision_score(g[LABEL], p[g.index]) for _, g in df_s.groupby("session_id")
               if 0 < g[LABEL].sum() < len(g)]
        loss_rows.append(dict(model=name, cv="leave-one-session-out", pooled_pr_auc=m["pr_auc"],
                              pooled_roc_auc=m["roc_auc"], recall_watch=m["recall"], precision_watch=m["precision"],
                              f2_watch=m["f2"], per_fold_pr_auc_mean=np.mean(per) if per else np.nan,
                              per_fold_pr_auc_std=np.std(per) if per else np.nan, folds_with_both_classes=len(per)))
        ps_loss.append(per_scenario(df_s, p, nw, nwa).assign(model=name))
    ps_loss = pd.concat(ps_loss)
    ps_loss.to_csv(out / "per_scenario_loso_session.csv", index=False)
    print(ps_loss[ps_loss.model == winner].drop(columns="model").round(2).to_string(index=False))
    say_failures(ps_loss[ps_loss.model == winner], "leave-one-session-out")

    print("\n=== STEP 8: leave-one-SCENARIO-out (train on the other 10 scenarios, all splits) ===")
    loso_rows = []
    for name in MODEL_NAMES + BASELINES:
        p = oof(df_s, name, mode, best.get(name) or None, "scenario")
        nw, nwa, _ = thr[name]
        per = per_scenario(df_s, p, nw, nwa)
        aps = []
        for sc in per.scenario:
            g = df_s[df_s.scenario == sc]
            if 0 < g[LABEL].sum() < len(g):
                aps.append(average_precision_score(g[LABEL], p[g.index]))
        m = metrics(df_s, p, nw, binary_brier=name in BASELINES)
        loss_rows.append(dict(model=name, cv="leave-one-scenario-out", pooled_pr_auc=m["pr_auc"],
                              pooled_roc_auc=m["roc_auc"], recall_watch=m["recall"], precision_watch=m["precision"],
                              f2_watch=m["f2"], per_fold_pr_auc_mean=np.mean(aps), per_fold_pr_auc_std=np.std(aps),
                              folds_with_both_classes=len(aps)))
        loso_rows += per.assign(model=name).to_dict("records")
    loso = pd.DataFrame(loso_rows)
    loso.to_csv(out / "loso_scenario.csv", index=False)
    print(f"  {winner}, each scenario scored by a model that never saw it:")
    print(loso[loso.model == winner].drop(columns="model").round(2).to_string(index=False))
    say_failures(loso[loso.model == winner], "leave-one-scenario-out")
    cvt = pd.DataFrame(loss_rows)
    cvt.to_csv(out / "cv_summary.csv", index=False)
    print("\n  CV summary (pooled = all out-of-fold rows together; per-fold = mean +/- std over folds that contain"
          " both classes):")
    print(cvt.round(3).to_string(index=False))
    if mode == "coverage":
        print("  NOTE: in the coverage set every session holds 1 row, so leave-one-session-out folds have one row "
              "each and only the pooled numbers mean anything.")

    print("\n=== STEP 9: overfitting checks ===")
    rng = np.random.default_rng(RANDOM_STATE)
    base_rate = tr[LABEL].mean()
    # with few positives per fold, AP of a RANDOM ranking sits well above the base rate; measure it on the same folds
    rand = []
    for _ in range(500):
        s_ = [average_precision_score(tr[LABEL].iloc[b], rng.random(len(b)))
              for _, b in gkf().split(tr, tr[LABEL], tr.session_id) if tr[LABEL].iloc[b].sum()]
        rand.append(np.mean(s_))
    r_mean, r_std = float(np.mean(rand)), float(np.std(rand))
    print(f"  null reference: random scores on the same GroupKFold folds give CV PR-AUC {r_mean:.3f} +/- {r_std:.3f} "
          f"(base rate {base_rate:.3f})")
    ov = []
    for name in MODEL_NAMES:
        params = best.get(name) or None
        train_ap = average_precision_score(tr[LABEL], scores[(name, "train")])
        cv_ap = table[(table.model == name)].cv_pr_auc.iloc[0]
        sh = []
        for _ in range(a.shuffles):
            ts = tr.copy()
            ts[LABEL] = rng.permutation(ts[LABEL].to_numpy())
            sh.append(cv_train(name, mode, params, ts, 0.5)[0])
        se = r_std / np.sqrt(a.shuffles)
        verdict = ("LEAKAGE SUSPECTED" if np.mean(sh) > r_mean + 2 * r_std else
                   "BORDERLINE (above random by > 2 standard errors)" if np.mean(sh) > r_mean + 2 * se else "ok")
        ov.append(dict(model=name, train_pr_auc=train_ap, cv_pr_auc=cv_ap, gap=train_ap - cv_ap,
                       shuffled_cv_pr_auc=np.mean(sh), shuffled_std=np.std(sh), random_score_cv_pr_auc=r_mean,
                       random_std=r_std, base_rate=base_rate, verdict=verdict))
    ov = pd.DataFrame(ov)
    ov.to_csv(out / "overfit_checks.csv", index=False)
    print(ov.round(3).to_string(index=False))
    for _, r in ov.iterrows():
        msg = (f"  {r.model}: train-vs-CV gap {r.gap:+.3f}"
               + (" (large: memorising train)" if r.gap > 0.15 else "")
               + f"; shuffled-label CV PR-AUC {r.shuffled_cv_pr_auc:.3f} vs random-score {r.random_score_cv_pr_auc:.3f}"
               f" (base rate {r.base_rate:.3f}) -> "
               + ("no leakage sign: falls to the random level" if r.verdict == "ok" else r.verdict))
        print(msg)

    print("\n  learning curve: fraction of TRAIN sessions -> PR-AUC on VALIDATION (mean of 5 draws; 1 at 100%)")
    sess = tr.session_id.unique()
    lc = []
    for frac in (0.25, 0.5, 0.75, 1.0):
        for name in MODEL_NAMES:
            vals, trs = [], []
            for rep in range(1 if frac == 1.0 else 5):
                pick = rng.choice(sess, max(2, int(round(frac * len(sess)))), replace=False)
                sub = tr[tr.session_id.isin(pick)]
                if sub[LABEL].nunique() < 2:
                    continue
                pipe = make_pipeline(name, mode, best.get(name) or None).fit(sub[FEATURES], sub[LABEL])
                vals.append(average_precision_score(va[LABEL], pipe.predict_proba(va[FEATURES])[:, 1]))
                trs.append(average_precision_score(sub[LABEL], pipe.predict_proba(sub[FEATURES])[:, 1]))
            lc.append(dict(fraction=frac, sessions=int(round(frac * len(sess))), model=name,
                           val_pr_auc=np.mean(vals), val_std=np.std(vals), train_pr_auc=np.mean(trs)))
    lc = pd.DataFrame(lc)
    lc.to_csv(out / "learning_curve.csv", index=False)
    print(lc.pivot(index=["fraction", "sessions"], columns="model", values="val_pr_auc").round(3).to_string())
    fig, ax = plt.subplots(figsize=(6, 4))
    for name in MODEL_NAMES:
        d = lc[lc.model == name]
        ax.errorbar(d.sessions, d.val_pr_auc, yerr=d.val_std, marker="o", color=COLORS[name], label=f"{name} val",
                    capsize=3)
        ax.plot(d.sessions, d.train_pr_auc, ls=":", color=COLORS[name], label=f"{name} train")
    ax.axhline(va[LABEL].mean(), color="#c3c2b7", ls="--", lw=1, label="val prevalence")
    ax.set_xlabel("train sessions used")
    ax.set_ylabel("PR-AUC")
    ax.set_title(f"Learning curve ({mode}, SIMULATED)", fontsize=10)
    ax.legend(fontsize=7, frameon=False, ncol=2)
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(out / "learning_curve.png", dpi=120)
    plt.close(fig)

    print("\n=== STEP 10: save ===")
    w, wa, rule = thr[winner]
    pipe = fitted[winner]
    medians = tr[FEATURES].median().to_dict()
    joblib.dump(dict(pipeline=pipe, model=winner, features=FEATURES, watch=w, warning=wa, warning_rule=rule,
                     train_medians=medians, dataset=mode, n_train_rows=len(tr), simulated=True,
                     note="trained on SIMULATED simulated packet streams only; fitted on TRAIN split"),
                mdir / "linkhealth.joblib")
    (mdir / "thresholds.json").write_text(json.dumps(dict(
        model=winner, WATCH=w, WARNING=wa, warning_rule=rule, watch_rule="F2-optimal on validation",
        ACCURACY=acc_thr[winner], accuracy_rule="accuracy-optimal on validation", horizon_s=HORIZON,
        silence_override_s=90, dataset=mode, simulated=True,
        all=dict((n, dict(WATCH=thr[n][0], WARNING=thr[n][1], warning_rule=thr[n][2])) for n in thr)), indent=2))
    (mdir / "features.json").write_text(json.dumps(dict(features=FEATURES, model=winner), indent=2))
    print(f"  saved {mdir / 'linkhealth.joblib'} ({winner}), thresholds.json, features.json")
    print(f"\nDone in {time.time() - t_start:.0f}s. Tables and plots in {out}")


if __name__ == "__main__":
    main()
