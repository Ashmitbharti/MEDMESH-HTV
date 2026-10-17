"""Steps 5-7: fit on TRAIN, choose F2 threshold on VALIDATION, report on TEST once; events, plots, winner."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, f1_score, fbeta_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score)

from .models import MODEL_NAMES, SIMPLICITY, TREE_MODELS, make_pipeline
from .tune import tscv

BASELINES = ["persistence", "always_no"]
# reference categorical palette (dataviz skill), fixed order; baselines in neutral ink
COLORS = {"logreg": "#2a78d6", "rf": "#eb6834", "lgbm": "#1baf7a", "xgb": "#eda100",
          "persistence": "#0b0b0b", "always_no": "#8a8984"}


def best_f2_threshold(y, p):
    """Probability cut-off that maximises F2 on validation. Ties go to the higher (fewer alarms) cut-off."""
    best_t, best_f = 0.5, -1.0
    for t in np.unique(p):
        f = fbeta_score(y, (p >= t).astype(int), beta=2, zero_division=0)
        if f >= best_f:
            best_t, best_f = float(t), f
    return best_t, best_f


def baseline_score(name, level_today, thr):
    if name == "persistence":
        return (level_today > thr).astype(float).to_numpy()
    return np.zeros(len(level_today))


def metrics(y, p, pred):
    y = np.asarray(y)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return dict(accuracy=accuracy_score(y, pred),
                precision=precision_score(y, pred, zero_division=0), recall=recall_score(y, pred, zero_division=0),
                f1=f1_score(y, pred, zero_division=0), f2=fbeta_score(y, pred, beta=2, zero_division=0),
                pr_auc=average_precision_score(y, p) if y.sum() else np.nan,
                roc_auc=roc_auc_score(y, p) if 0 < y.sum() < len(y) else np.nan,
                tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp))


def events(y: pd.Series, pred: np.ndarray, merge_gap: int = 2):
    """Event = run of high TARGET days (issue date + 1) merged when separated by <= merge_gap non-high days.
    Caught = at least one alarm whose target day falls inside the event."""
    target = y.index + pd.Timedelta(days=1)
    high = target[y.to_numpy() == 1]
    alarms = target[np.asarray(pred) == 1]
    evs = []
    for d in high:
        if evs and (d - evs[-1][1]).days <= merge_gap + 1:
            evs[-1][1] = d
        else:
            evs.append([d, d])
    caught = sum(bool(((alarms >= s) & (alarms <= e)).any()) for s, e in evs)
    return len(evs), caught


def cv_on_train(name, sp, params, thr):
    """TimeSeriesSplit on TRAIN: PR-AUC and F1 (F1 at the validation-chosen cut-off)."""
    X, y, lv = sp.X["train"], sp.y["train"], sp.level_today["train"]
    ap, f1 = [], []
    for tr, te in tscv().split(X):
        if name in BASELINES:
            p = baseline_score(name, lv.iloc[te], sp.threshold)
        else:
            p = make_pipeline(name, params).fit(X.iloc[tr], y.iloc[tr]).predict_proba(X.iloc[te])[:, 1]
        yt = y.iloc[te].to_numpy()
        if yt.sum():
            ap.append(average_precision_score(yt, p))
        f1.append(f1_score(yt, (p >= thr).astype(int), zero_division=0))
    return np.mean(ap), np.std(ap), np.mean(f1), np.std(f1)


def evaluate_station(sp, best_params, out_dir):
    fitted, cutoffs, scores = {}, {}, {}
    for name in MODEL_NAMES:
        pipe = make_pipeline(name, best_params.get(name) or None).fit(sp.X["train"], sp.y["train"])
        fitted[name] = pipe
        for split in ("val", "test"):
            scores[(name, split)] = pipe.predict_proba(sp.X[split])[:, 1]
        cutoffs[name], f2 = best_f2_threshold(sp.y["val"].to_numpy(), scores[(name, "val")])
        print(f"    {name}: fitted on train; F2-optimal cut-off on VALIDATION = {cutoffs[name]:.4f} (val F2 {f2:.3f})")
    for name in BASELINES:
        cutoffs[name] = 0.5
        for split in ("val", "test"):
            scores[(name, split)] = baseline_score(name, sp.level_today[split], sp.threshold)

    rows = []
    for name in MODEL_NAMES + BASELINES:
        cv = cv_on_train(name, sp, best_params.get(name) or None, cutoffs[name])
        for split in ("val", "test"):
            p = scores[(name, split)]
            pred = (p >= cutoffs[name]).astype(int)
            n_ev, caught = events(sp.y[split], pred)
            rows.append(dict(station=sp.station, model=name, split=split, cutoff=cutoffs[name],
                             **metrics(sp.y[split], p, pred), events=n_ev, events_caught=caught,
                             events_missed=n_ev - caught, cv_pr_auc=cv[0], cv_pr_auc_std=cv[1],
                             cv_f1=cv[2], cv_f1_std=cv[3]))
    table = pd.DataFrame(rows)
    plot_confusion(table[table.split == "test"], sp.station, out_dir)
    plot_pr(sp, scores, cutoffs, out_dir)
    imp = importances(fitted, table, sp, out_dir)
    return table, fitted, cutoffs, imp


def print_table(table):
    t = table.copy()
    t["cv_pr_auc"] = t.apply(lambda r: f"{r.cv_pr_auc:.3f}+/-{r.cv_pr_auc_std:.3f}", axis=1)
    t["cv_f1"] = t.apply(lambda r: f"{r.cv_f1:.3f}+/-{r.cv_f1_std:.3f}", axis=1)
    t["events"] = t.apply(lambda r: f"{r.events_caught}/{r.events}", axis=1)
    cols = ["model", "split", "precision", "recall", "f1", "f2", "pr_auc", "roc_auc", "accuracy",
            "tn", "fp", "fn", "tp", "events", "cv_pr_auc", "cv_f1"]
    for split in ("val", "test"):
        print(f"    --- {split.upper()} (events = caught/total) ---")
        print(t[t.split == split][cols].drop(columns="split").round(3).to_string(index=False))


def plot_confusion(test_rows, station, out_dir):
    fig, axes = plt.subplots(1, len(test_rows), figsize=(3.1 * len(test_rows), 3.2))
    for ax, (_, r) in zip(axes, test_rows.iterrows()):
        m = np.array([[r.tn, r.fp], [r.fn, r.tp]])
        vmax = max(1, m[1].sum() * 3)
        ax.imshow(m, cmap="Blues", vmin=0, vmax=vmax)
        for i in range(2):
            for j in range(2):
                ax.text(j, i, str(m[i, j]), ha="center", va="center", fontsize=12,
                        color="white" if m[i, j] > 0.5 * vmax else "#0b0b0b")
        ax.set_xticks([0, 1], ["pred 0", "pred 1"])
        ax.set_yticks([0, 1], ["true 0", "true 1"])
        ax.set_title(r.model, fontsize=10)
    fig.suptitle(f"{station} - TEST confusion matrices (fixed validation cut-offs)", fontsize=11)
    fig.tight_layout()
    fig.savefig(out_dir / "confusion_matrices_test.png", dpi=120)
    plt.close(fig)


def plot_pr(sp, scores, cutoffs, out_dir):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), sharey=True)
    for ax, split in zip(axes, ("val", "test")):
        y = sp.y[split].to_numpy()
        for name in MODEL_NAMES:
            pr, rc, _ = precision_recall_curve(y, scores[(name, split)])
            ax.plot(rc, pr, lw=2, color=COLORS[name],
                    label=f"{name} (AP {average_precision_score(y, scores[(name, split)]):.3f})")
        for name, marker in (("persistence", "D"), ("always_no", "o")):
            pred = scores[(name, split)]
            ax.plot(recall_score(y, pred, zero_division=0), precision_score(y, pred, zero_division=0),
                    marker=marker, ms=9, ls="none", color=COLORS[name], markeredgecolor="white", markeredgewidth=2,
                    label=f"{name} (single point)")
        ax.axhline(y.mean(), color="#c3c2b7", lw=1, ls="--", label=f"prevalence {y.mean():.3f}")
        ax.set_title(f"{split.upper()} ({int(y.sum())} high days)", fontsize=10)
        ax.set_xlabel("recall")
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].set_ylabel("precision")
    axes[1].legend(fontsize=8, loc="upper right", frameon=False)
    fig.suptitle(f"{sp.station} - precision/recall, raw features only", fontsize=11)
    fig.tight_layout()
    fig.savefig(out_dir / "pr_curves.png", dpi=120)
    plt.close(fig)


def importances(fitted, table, sp, out_dir):
    val = table[(table.split == "val") & table.model.isin(TREE_MODELS)]
    name = val.sort_values("pr_auc", ascending=False).iloc[0]["model"]
    m = fitted[name].named_steps["model"]
    if name == "lgbm":
        vals = m.booster_.feature_importance(importance_type="gain")
        kind = "gain"
    elif name == "xgb":
        vals, kind = m.feature_importances_, "gain"
    else:
        vals, kind = m.feature_importances_, "impurity decrease"
    imp = pd.Series(vals, index=sp.features, dtype=float)
    imp = (imp / imp.sum()).sort_values(ascending=False)
    imp.rename("share").to_csv(out_dir / f"feature_importance_{name}.csv")
    print(f"    feature importance, best tree model on validation = {name} ({kind}, share of total): "
          + ", ".join(f"{k}={v:.2f}" for k, v in imp.items()))
    return name, imp


def pick_winner(table, tol=0.01):
    """Among ML models: highest validation PR-AUC; within `tol` -> highest F2; within `tol` -> simplest."""
    v = table[(table.split == "val") & table.model.isin(MODEL_NAMES)].copy()
    tied = v[v.pr_auc >= v.pr_auc.max() - tol]
    tied = tied[tied.f2 >= tied.f2.max() - tol]
    tied = tied.assign(s=tied.model.map(SIMPLICITY)).sort_values(["s", "pr_auc"], ascending=[True, False])
    return tied.iloc[0]["model"], v
