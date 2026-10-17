"""v2 experiments: rain, three feature sets, two targets (next-day / same-day), two percentiles.

Per station x target x percentile:
  1. LightGBM (fast-tuned) CV on TRAIN for LEVEL_ONLY / LEAN / BIG / LEAN_NO_RAIN  -> choose the set
     (LEAN unless BIG beats it by more than one CV std).
  2. All four models tuned on TRAIN (TimeSeriesSplit) on the chosen set.
  3. Decision cut-off chosen on VALIDATION (max F2); TEST scored once with that fixed cut-off.
Validation and test are never passed to any tuning call.
"""
import json
import time
import warnings
from dataclasses import dataclass

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve, precision_score, recall_score
from sklearn.model_selection import RandomizedSearchCV, cross_validate

from .config import MODELS_DIR, RANDOM_STATE, RESULTS_DIR, STATIONS
from .evaluate import COLORS, best_f2_threshold, metrics
from .features import TODAY_DISCH, TODAY_LEVEL_DERIVED, build_frame, drop_constant, feature_sets, snow_usable
from .label import label, persistence, split_dates, threshold, usable_rows
from .models import MODEL_NAMES, SIMPLICITY, TREE_MODELS, make_pipeline, search_space, to_jsonable
from .tune import tscv

warnings.filterwarnings("ignore", category=UserWarning, message=".*feature names.*")
warnings.filterwarnings("ignore", message=".*No positive class found in y_true.*")

OUT = RESULTS_DIR / "v2"
PCTS = (95, 97)
TARGETS = ("next", "same")
SETS = ("LEVEL_ONLY", "LEAN", "BIG", "LEAN_NO_RAIN")
NAMED_FLOODS = ["2013-07-08", "2024-07-16", "2024-08-17"]
FAST_ITER = 10
MIN_GAIN = 0.01


@dataclass
class Data:
    station: str
    target: str
    pct: float
    thr: float
    X: pd.DataFrame
    y: pd.Series
    split: np.ndarray
    persist: pd.Series
    sets: dict
    snow_msg: str

    def part(self, s, cols):
        m = self.split == s
        return self.X.loc[m, cols], self.y[m]

    @property
    def neg_pos(self):
        y = self.y[self.split == "train"]
        return float((y == 0).sum() / max(y.sum(), 1))


def build(station, df, target, pct, has_rain) -> Data:
    tr_end, va_end = split_dates(df)
    thr = threshold(df.loc[:tr_end, "LEVEL"], pct)
    use_snow, snow_msg = snow_usable(df, tr_end)
    F = build_frame(df, thr, use_snow)
    y = label(df, target, thr)
    rows = usable_rows(df, target) & y.notna()
    F, y = F[rows], y[rows].astype(int)
    split = np.where(F.index <= tr_end, "train", np.where(F.index <= va_end, "val", "test"))
    sets = {}
    for name, cols in feature_sets(target, has_rain, use_snow).items():
        keep, dropped = drop_constant(cols, F[split == "train"])
        sets[name] = keep
        if dropped:
            print(f"    {name}: dropped constant columns {dropped}")
    if target == "same":
        bad = {c for cols in sets.values() for c in cols} & (TODAY_LEVEL_DERIVED | TODAY_DISCH)
        if bad:
            raise SystemExit(f"SAME-DAY inputs contain today-derived features: {bad}")
    return Data(station, target, pct, thr, F, y, split, persistence(df, target, thr)[rows], sets, snow_msg)


def print_split(d: Data):
    tname = "NEXT-DAY" if d.target == "next" else "SAME-DAY"
    print(f"  [{d.station} {tname} p{d.pct}] threshold LEVEL > {d.thr:.3f} m above gauge datum (train p{d.pct})")
    for s in ("train", "val", "test"):
        m = d.split == s
        y = d.y[m]
        print(f"    {s:<5} {d.X.index[m].min().date()} -> {d.X.index[m].max().date()}  n={m.sum():5d}  "
              f"positives={int(y.sum()):4d} ({100 * y.mean():.2f}%)")
        if s != "train" and y.sum() < 10:
            print(f"    !!!!! WARNING: {s} has only {int(y.sum())} positive days (<10): metrics are very noisy !!!!!")


def tune(name, X, y, neg_pos, n_iter):
    """RandomizedSearchCV on TRAIN rows only. Returns params ({} = default kept), CV mean, CV std."""
    d = cross_validate(make_pipeline(name), X, y, cv=tscv(), scoring="average_precision", n_jobs=-1)
    rs = RandomizedSearchCV(make_pipeline(name), search_space(name, neg_pos), n_iter=n_iter,
                            scoring="average_precision", cv=tscv(), random_state=RANDOM_STATE, n_jobs=-1, refit=False)
    rs.fit(X, y)
    t_mean, t_std = rs.best_score_, rs.cv_results_["std_test_score"][rs.best_index_]
    d_mean, d_std = d["test_score"].mean(), d["test_score"].std()
    if t_mean - d_mean < MIN_GAIN:
        return {}, d_mean, d_std, False
    return to_jsonable(rs.best_params_), t_mean, t_std, True


def events(dates, y, pred, target, merge_gap=2):
    """Event = run of high TARGET days merged across <= merge_gap non-high days.
    caught = an alarm targets a day inside the event. day_before (NEXT-DAY only) = the forecast
    issued the day before onset said 'high tomorrow'."""
    tgt = pd.DatetimeIndex(dates) + (pd.Timedelta(days=1) if target == "next" else pd.Timedelta(0))
    high = tgt[np.asarray(y) == 1]
    alarms = set(tgt[np.asarray(pred) == 1])
    evs = []
    for t in high:
        if evs and (t - evs[-1][1]).days <= merge_gap + 1:
            evs[-1][1] = t
        else:
            evs.append([t, t])
    caught = sum(any(a in alarms for a in pd.date_range(s, e)) for s, e in evs)
    before = sum(s in alarms for s, _ in evs) if target == "next" else np.nan
    return len(evs), caught, before


def score_rows(d, label_, cols, p_val, p_test, cutoff, base):
    rows = []
    for s, p in (("val", p_val), ("test", p_test)):
        m = d.split == s
        y = d.y[m].to_numpy()
        pred = (p >= cutoff).astype(int)
        n_ev, caught, before = events(d.X.index[m], y, pred, d.target)
        rows.append(dict(**base, model=label_, split=s, n_features=len(cols), cutoff=cutoff,
                         **metrics(y, p, pred), events=n_ev, events_caught=caught, events_day_before=before))
    return rows


def fit_eval(d, name, cols, params, cv_mean, cv_std, base):
    Xtr, ytr = d.part("train", cols)
    pipe = make_pipeline(name, params or None).fit(Xtr, ytr)
    p_val = pipe.predict_proba(d.part("val", cols)[0])[:, 1]
    p_test = pipe.predict_proba(d.part("test", cols)[0])[:, 1]
    cutoff, _ = best_f2_threshold(d.part("val", cols)[1].to_numpy(), p_val)
    rows = score_rows(d, name, cols, p_val, p_test, cutoff, dict(base, cv_pr_auc=cv_mean, cv_std=cv_std))
    return pipe, cutoff, rows, (p_val, p_test)


def baseline_rows(d, base):
    rows, cv = [], {}
    ytr, ptr = d.y[d.split == "train"], d.persist[d.split == "train"]
    for nm, score in (("persistence", d.persist), ("always_no", d.persist * 0)):
        aps = [average_precision_score(ytr.iloc[te], score[d.split == "train"].iloc[te])
               for _, te in tscv().split(ytr) if ytr.iloc[te].sum()]
        cv[nm] = (np.mean(aps), np.std(aps))
        rows += score_rows(d, nm, [], score[d.split == "val"].to_numpy(), score[d.split == "test"].to_numpy(), 0.5,
                           dict(base, feature_set="-", cv_pr_auc=cv[nm][0], cv_std=cv[nm][1]))
    return rows


def importances(pipe, name, cols, top=15):
    m = pipe.named_steps["model"]
    if name == "lgbm":
        v, kind = m.booster_.feature_importance(importance_type="gain"), "gain"
    elif name == "xgb":
        v, kind = m.feature_importances_, "gain"
    else:
        v, kind = m.feature_importances_, "impurity"
    s = pd.Series(v, index=cols, dtype=float)
    return (s / s.sum()).sort_values(ascending=False).head(top), kind


def pick_winner(rows):
    v = pd.DataFrame(rows)
    v = v[(v.split == "val") & v.model.isin(MODEL_NAMES)]
    tied = v[v.pr_auc >= v.pr_auc.max() - 0.01]
    tied = tied[tied.f2 >= tied.f2.max() - 0.01]
    return tied.assign(s=tied.model.map(SIMPLICITY)).sort_values(["s", "pr_auc"], ascending=[True, False]).iloc[0].model


def run_combo(station, df, target, pct, has_rain, n_iter):
    t0 = time.time()
    d = build(station, df, target, pct, has_rain)
    print_split(d)
    base = dict(station=station, target=target, pct=pct)
    rows = []

    # 1. feature-set comparison: LightGBM fast-tuned, CV on TRAIN only
    print(f"    feature-set comparison (LightGBM, n_iter={FAST_ITER}, TimeSeriesSplit CV on train):")
    cvs = {}
    for sname in SETS:
        cols = d.sets[sname]
        Xtr, ytr = d.part("train", cols)
        params, m, s, tuned = tune("lgbm", Xtr, ytr, d.neg_pos, FAST_ITER)
        cvs[sname] = (m, s)
        _, _, r, _ = fit_eval(d, "lgbm", cols, params, m, s, dict(base, feature_set=sname, experiment="set_compare"))
        rows += r
        print(f"      {sname:<13} {len(cols):2d} features  CV PR-AUC {m:.3f} +/- {s:.3f}")
    gap = cvs["BIG"][0] - cvs["LEAN"][0]
    one_std = max(cvs["BIG"][1], cvs["LEAN"][1])
    chosen = "BIG" if gap > one_std else "LEAN"
    print(f"    -> chosen set {chosen} (BIG - LEAN = {gap:+.3f}, one std = {one_std:.3f}); "
          f"rain ablation LEAN - LEAN_NO_RAIN = {cvs['LEAN'][0] - cvs['LEAN_NO_RAIN'][0]:+.3f} CV PR-AUC")

    # 2. four models on the chosen set
    cols = d.sets[chosen]
    Xtr, ytr = d.part("train", cols)
    fitted, cutoffs, preds, params_all = {}, {}, {}, {}
    for name in MODEL_NAMES:
        params, m, s, tuned = tune(name, Xtr, ytr, d.neg_pos, n_iter)
        params_all[name] = params
        pipe, cut, r, pr = fit_eval(d, name, cols, params, m, s, dict(base, feature_set=chosen, experiment="models"))
        fitted[name], cutoffs[name], preds[name] = pipe, cut, pr
        rows += r
    rows += baseline_rows(d, dict(base, experiment="baseline"))
    winner = pick_winner([r for r in rows if r["experiment"] == "models"])

    best_tree = max(TREE_MODELS, key=lambda n: next(r["pr_auc"] for r in rows if r["experiment"] == "models"
                                                    and r["model"] == n and r["split"] == "val"))
    imp, kind = importances(fitted[best_tree], best_tree, cols)
    print(f"    winner (validation PR-AUC, then F2, then simplicity): {winner}; time {time.time() - t0:.0f}s")
    return dict(d=d, rows=rows, chosen=chosen, cols=cols, cvs=cvs, fitted=fitted, cutoffs=cutoffs, preds=preds,
                winner=winner, params=params_all, best_tree=best_tree, imp=imp, imp_kind=kind)


# ---------------------------------------------------------------- reporting

def station_table(df_rows: pd.DataFrame):
    t = df_rows.copy()
    val = t[t.split == "val"].set_index(["target", "pct", "experiment", "feature_set", "model"])
    test = t[t.split == "test"].set_index(["target", "pct", "experiment", "feature_set", "model"])
    out = pd.DataFrame({
        "val_PR": val.pr_auc.round(3), "val_F2": val.f2.round(3),
        "prec": test.precision.round(3), "rec": test.recall.round(3), "F2": test.f2.round(3),
        "PR-AUC": test.pr_auc.round(3),
        "CV PR-AUC": (test.cv_pr_auc.round(3).astype(str) + "+/-" + test.cv_std.round(3).astype(str)),
        "TN FP FN TP": test.tn.astype(str) + " " + test.fp.astype(str) + " " + test.fn.astype(str) + " " + test.tp.astype(str),
        "events": test.events_caught.astype(str) + "/" + test.events.astype(str),
        "day_before": test.events_day_before.map(lambda v: "-" if pd.isna(v) else str(int(v))),
    })
    return out.reset_index()


def plot_station(station, results, out):
    combos = [(t, p) for t in TARGETS for p in PCTS]
    fig, axes = plt.subplots(1, 4, figsize=(19, 4.4), sharey=True)
    for ax, (t, p) in zip(axes, combos):
        r = results[(t, p)]
        d = r["d"]
        y = d.y[d.split == "test"].to_numpy()
        for name in MODEL_NAMES:
            sc = r["preds"][name][1]
            pr, rc, _ = precision_recall_curve(y, sc)
            ax.plot(rc, pr, lw=2, color=COLORS[name], label=f"{name} AP {average_precision_score(y, sc):.2f}")
        ps = d.persist[d.split == "test"].to_numpy()
        ax.plot(recall_score(y, ps, zero_division=0), precision_score(y, ps, zero_division=0), "D", ms=9,
                color=COLORS["persistence"], markeredgecolor="white", markeredgewidth=2, label="persistence")
        ax.axhline(y.mean(), color="#c3c2b7", lw=1, ls="--", label=f"prevalence {y.mean():.3f}")
        ax.set_title(f"{'NEXT-DAY' if t == 'next' else 'SAME-DAY'} p{p} ({r['chosen']}, {int(y.sum())} high days)",
                     fontsize=10)
        ax.set_xlabel("recall")
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(fontsize=7, frameon=False, loc="upper right")
    axes[0].set_ylabel("precision")
    fig.suptitle(f"{station} - TEST precision/recall (v2)", fontsize=11)
    fig.tight_layout()
    fig.savefig(out / f"{station}_pr_curves.png", dpi=110)
    plt.close(fig)

    names = MODEL_NAMES + ["persistence", "always_no"]
    fig, axes = plt.subplots(4, len(names), figsize=(2.6 * len(names), 10))
    for i, (t, p) in enumerate(combos):
        rows = pd.DataFrame(results[(t, p)]["rows"])
        rows = rows[(rows.split == "test") & rows.experiment.isin(["models", "baseline"])].set_index("model")
        for j, n in enumerate(names):
            ax, rr = axes[i, j], rows.loc[n]
            m = np.array([[rr.tn, rr.fp], [rr.fn, rr.tp]])
            vmax = max(1, m[1].sum() * 3)
            ax.imshow(m, cmap="Blues", vmin=0, vmax=vmax)
            for a in range(2):
                for b in range(2):
                    ax.text(b, a, str(m[a, b]), ha="center", va="center", fontsize=10,
                            color="white" if m[a, b] > 0.5 * vmax else "#0b0b0b")
            ax.set_xticks([0, 1], ["pred 0", "pred 1"], fontsize=7)
            ax.set_yticks([0, 1], ["true 0", "true 1"], fontsize=7)
            ax.set_title(f"{n}\n{'NEXT' if t == 'next' else 'SAME'} p{p}", fontsize=8)
    fig.suptitle(f"{station} - TEST confusion matrices (validation cut-offs)", fontsize=11)
    fig.tight_layout()
    fig.savefig(out / f"{station}_confusion_matrices.png", dpi=110)
    plt.close(fig)


def top_peak_days(df, n=10, pct=97, gap_days=2):
    """Same logic as `flood_data.py events`: runs above the all-data p97, merged if closer than gap_days."""
    s = df["LEVEL"].dropna()
    above = s > s.quantile(pct / 100)
    runs = [(g.index[0], g.index[-1], g.idxmax(), g.max()) for _, g in s[above].groupby((above != above.shift()).cumsum()[above])]
    merged = []
    for r in runs:
        if merged and (r[0] - merged[-1][1]) < pd.Timedelta(days=gap_days):
            a = merged[-1]
            merged[-1] = (a[0], r[1], a[2] if a[3] >= r[3] else r[2], max(a[3], r[3]))
        else:
            merged.append(r)
    return [str(e[2].date()) for e in sorted(merged, key=lambda e: -e[3])[:n]]


def known_flood_check(station, df, results):
    dates = list(dict.fromkeys(NAMED_FLOODS + top_peak_days(df)))
    lines = []
    for date in dates:
        day = pd.Timestamp(date)
        row = {"date": date, "named": date in NAMED_FLOODS}
        if day < df.index.min() or day > df.index.max() or pd.isna(df["LEVEL"].get(day)):
            row["status"] = "not in data"
            lines.append(row)
            continue
        row["level"] = round(float(df.loc[day, "LEVEL"]), 3)
        for t, issue in (("next", day - pd.Timedelta(days=1)), ("same", day)):
            r = results[(t, 97)]
            d = r["d"]
            row[f"{t}_thr"] = round(d.thr, 3)
            if issue not in d.X.index:
                row[f"{t}_flag"] = "no usable row"
                continue
            i = d.X.index.get_loc(issue)
            sp = d.split[i]
            p = float(r["fitted"][r["winner"]].predict_proba(d.X.loc[[issue], r["cols"]])[0, 1])
            flag = p >= r["cutoffs"][r["winner"]]
            row["split"] = sp
            row[f"{t}_flag"] = f"{'YES' if flag else 'no'} (p={p:.2f}, {r['winner']})" + \
                               ("  [TRAIN - not evidence]" if sp == "train" else "")
        lines.append(row)
    return pd.DataFrame(lines)


def run(cleaned, has_rain, n_iter):
    OUT.mkdir(parents=True, exist_ok=True)
    (MODELS_DIR / "v2").mkdir(parents=True, exist_ok=True)
    if not has_rain:
        print("  !!! Rain file absent: rain features and the rain ablation are skipped !!!")
    all_rows, summary, best_params, known = [], {}, {}, []
    t_all = time.time()
    for station in STATIONS:
        df = cleaned[station]
        print(f"\n################ v2 {station} ################")
        tr_end, _ = split_dates(df)
        print(f"  {snow_usable(df, tr_end)[1]} -> snow_on_ground "
              f"{'USED' if snow_usable(df, tr_end)[0] else 'SKIPPED'}")
        for target in TARGETS:
            sets = feature_sets(target, has_rain, snow_usable(df, tr_end)[0])
            print(f"  {'NEXT-DAY' if target == 'next' else 'SAME-DAY'} feature sets:")
            for k, v in sets.items():
                print(f"    {k} ({len(v)}): {v}")
        results = {}
        for target in TARGETS:
            for pct in PCTS:
                r = run_combo(station, df, target, pct, has_rain, n_iter)
                results[(target, pct)] = r
                all_rows += r["rows"]
                best_params[f"{station}/{target}/p{pct}"] = {"feature_set": r["chosen"], **r["params"]}
                print(f"    top-{len(r['imp'])} importances ({r['best_tree']}, {r['imp_kind']}): "
                      + ", ".join(f"{k}={v:.3f}" for k, v in r["imp"].items()))
                r["imp"].rename("share").to_csv(OUT / f"importance_{station}_{target}_p{pct}_{r['best_tree']}.csv")
                w = r["winner"]
                joblib.dump(dict(pipeline=r["fitted"][w], model=w, features=r["cols"], cutoff=r["cutoffs"][w],
                                 level_threshold=r["d"].thr, pct=pct, target=target, station=station,
                                 feature_set=r["chosen"]),
                            MODELS_DIR / "v2" / f"best_{station}_{target}_p{pct}.joblib")
        st_rows = pd.DataFrame([x for r in results.values() for x in r["rows"]])
        tab = station_table(st_rows)
        print(f"\n  ===== {station}: VAL PR-AUC/F2 and TEST metrics (cut-offs fixed on validation) =====")
        with pd.option_context("display.width", 250, "display.max_columns", 30):
            print(tab.to_string(index=False))
        print("  NOTE: with this few high-water events, differences of a few hundredths are within noise "
              "(compare against the CV std).")
        tab.to_csv(OUT / f"table_{station}.csv", index=False)
        plot_station(station, results, OUT)
        kf = known_flood_check(station, df, results)
        print(f"\n  Known-flood check {station} (p97 winners; NEXT-DAY = forecast issued the day before):")
        print(kf.to_string(index=False))
        print("  Days in the TRAIN split were seen during fitting and do NOT count as evidence.")
        known.append(kf.assign(station=station))
        summary[station] = {f"{t}/p{p}": dict(winner=r["winner"], feature_set=r["chosen"])
                            for (t, p), r in results.items()}

    pd.DataFrame(all_rows).to_csv(RESULTS_DIR / "model_comparison_v2.csv", index=False)
    pd.concat(known).to_csv(OUT / "known_flood_check.csv", index=False)
    (OUT / "best_params_v2.json").write_text(json.dumps(best_params, indent=2))
    (OUT / "winners_v2.json").write_text(json.dumps(summary, indent=2))
    print(f"\nv2 done in {time.time() - t_all:.0f}s -> results/model_comparison_v2.csv, results/v2/, models/v2/")
