"""Model B: the 11-gauge pipeline with the RAIN-RATE vs DRAINAGE feature sets, chosen per station.

Per station (all selection on TRAIN cross-validation and VALIDATION; TEST is scored once at the end):
  1. sets: LEAN | LEAN+INT (intensity) | LEAN+INT+DRAIN (drainage proxies) | RATE (+ net features).
     Gauges without usable hourly rain have no INT features; their DRAIN/RATE sets use daily rain.
  2. LogisticRegression and LightGBM, fast-tuned (n_iter=10) with TimeSeriesSplit(5, gap=3) on TRAIN:
     CV PR-AUC mean +/- std, then fitted on TRAIN and scored on VALIDATION (PR-AUC, F2 at the F2-optimal cut).
     A set's score = the better of the two models by CV PR-AUC.
  3. Decision: switch from LEAN to the best non-LEAN set only if its CV PR-AUC beats LEAN's by more than one
     fold std (the larger of the two stds) AND its validation PR-AUC is not lower. Otherwise keep LEAN.
  4. All four models re-tuned (n_iter=40) on the chosen set; best on VALIDATION PR-AUC/F2; WATCH / WARNING on
     VALIDATION as before; TEST once.
"""
import contextlib
import io
import json
import shutil
import time
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score
from sklearn.model_selection import cross_validate

from . import clean, fleet, loo
from .config import MODELS_DIR, RESULTS_DIR
from .evaluate import best_f2_threshold
from .experiments import events, tune
from .features import drop_constant
from .gauges import load_gauges
from .models import MODEL_NAMES, make_pipeline
from .rain_gauges import choose_all as choose_daily, rain_frame
from .rain_hourly import choose_all as choose_hourly, hourly_series
from .rate import DRAINAGE, INTENSITY, NET, estimate_capacity, hourly_to_daily, rate_features
from .tune import tscv

warnings.filterwarnings("ignore", category=UserWarning)
OUT = RESULTS_DIR / "modelb"
FAST_ITER = 10
SET_ORDER = ["LEAN", "LEAN+INT", "LEAN+INT+DRAIN", "RATE"]
NEW = INTENSITY + DRAINAGE + NET


def prepare(st, df, hourly_id):
    d = fleet.build(st, df)
    sp, rows = d["split"], d["X"].index
    train_rows = rows[sp == "train"]
    hd = hourly_to_daily(hourly_series(hourly_id)) if hourly_id else None
    stats = dict(thr=d["thr"], train_median_level=float(df.loc[: d["tr_end"], "LEVEL"].median()),
                 rate_var="max_1h_rain" if hd is not None else "rain_today", capacity=None, median_train_ant7=None)
    base = rate_features(df, hd, stats)
    rate = base["max_1h_rain"] if hd is not None else df["TOTAL_PRECIPITATION"].astype(float)
    cap, cap_tab, cap_reason = estimate_capacity(rate.loc[train_rows], d["y"].loc[train_rows])
    stats["capacity"] = cap
    stats["median_train_ant7"] = float(base["antecedent_7d"].loc[train_rows].median())
    X = d["X"].join(rate_features(df, hd, stats).loc[rows])
    lean = list(d["cols"])
    intensity = [c for c in INTENSITY if c in X.columns] if hd is not None else []
    net = NET if cap else []
    Xtr = X.loc[train_rows]
    keep = lambda cols: drop_constant(cols, Xtr)[0]
    sets = {"LEAN": lean}
    if intensity:
        sets["LEAN+INT"] = keep(lean + intensity)
    sets["LEAN+INT+DRAIN"] = keep(lean + intensity + DRAINAGE)
    if net:
        sets["RATE"] = keep(lean + intensity + DRAINAGE + net)
    return d, X, sets, stats, cap_tab, cap_reason


def compare(st, d, X, sets):
    sp, y = d["split"], d["y"]
    ytr, yva = y[sp == "train"], y[sp == "val"].to_numpy()
    neg_pos = float((ytr == 0).sum() / max(ytr.sum(), 1))
    rows, fitted = [], {}
    for sname, cols in sets.items():
        Xtr, Xva = X.loc[sp == "train", cols], X.loc[sp == "val", cols]
        for m in ("logreg", "lgbm"):
            params, cv_m, cv_s, _ = tune(m, Xtr, ytr, neg_pos, FAST_ITER)
            pipe = make_pipeline(m, params or None).fit(Xtr, ytr)
            p = pipe.predict_proba(Xva)[:, 1]
            rows.append(dict(station=st, set=sname, n_features=len(cols), model=m, cv_pr_auc=cv_m, cv_std=cv_s,
                             val_pr_auc=average_precision_score(yva, p), val_f2=best_f2_threshold(yva, p)[1]))
            fitted[(sname, m)] = pipe
    t = pd.DataFrame(rows)
    best = t.loc[t.groupby("set")["cv_pr_auc"].idxmax()].set_index("set").reindex([s for s in SET_ORDER if s in sets])
    lean = best.loc["LEAN"]
    others = best.drop(index="LEAN")
    cand = others["cv_pr_auc"].idxmax() if len(others) else None
    if cand is None:
        return t, best, "LEAN", "no alternative set", fitted
    c = best.loc[cand]
    std = max(c.cv_std, lean.cv_std)
    gain = c.cv_pr_auc - lean.cv_pr_auc
    val_ok = c.val_pr_auc >= lean.val_pr_auc
    if gain > std and val_ok:
        return t, best, cand, (f"{cand} CV PR-AUC {c.cv_pr_auc:.3f} vs LEAN {lean.cv_pr_auc:.3f} (+{gain:.3f} > fold std "
                               f"{std:.3f}) and val PR-AUC {c.val_pr_auc:.3f} >= {lean.val_pr_auc:.3f}"), fitted
    why = []
    if gain <= std:
        why.append(f"CV gain {gain:+.3f} is not more than one fold std ({std:.3f})")
    if not val_ok:
        why.append(f"val PR-AUC would drop ({c.val_pr_auc:.3f} < {lean.val_pr_auc:.3f})")
    return t, best, "LEAN", f"keep LEAN: best alternative {cand} - " + "; ".join(why), fitted


def importances(pipe, name, cols, top=15):
    m = pipe.named_steps["model"]
    if name == "lgbm":
        v = m.booster_.feature_importance(importance_type="gain")
    elif name == "logreg":
        v = np.abs(m.coef_[0])
    else:
        v = m.feature_importances_
    s = pd.Series(v, index=cols, dtype=float)
    return (s / s.sum()).sort_values(ascending=False).head(top)


def ablation(d, X, sets, chosen, model, params):
    """Same model and params with vs without the intensity features."""
    cols = sets[chosen]
    has = [c for c in cols if c in INTENSITY]
    if has:
        with_c, without_c = cols, [c for c in cols if c not in INTENSITY]
    elif "LEAN+INT" in sets:
        with_c, without_c = sets["LEAN+INT"] if chosen == "LEAN" else cols + [c for c in INTENSITY if c in X], cols
    else:
        return None
    sp, y = d["split"], d["y"]
    out = {}
    for tag, cc in (("with_intensity", with_c), ("without_intensity", without_c)):
        Xtr, ytr = X.loc[sp == "train", cc], y[sp == "train"]
        cv = cross_validate(make_pipeline(model, params or None), Xtr, ytr, cv=tscv(), scoring="average_precision",
                            n_jobs=-1)["test_score"]
        pipe = make_pipeline(model, params or None).fit(Xtr, ytr)
        out[tag] = dict(cv=cv.mean(), cv_std=cv.std(),
                        val=average_precision_score(y[sp == "val"], pipe.predict_proba(X.loc[sp == "val", cc])[:, 1]),
                        test=average_precision_score(y[sp == "test"], pipe.predict_proba(X.loc[sp == "test", cc])[:, 1]))
    return out


def backup_lean():
    """Keep the LEAN-only fleet artifacts in models/fleet_lean/ before Model B takes over models/."""
    dst = MODELS_DIR / "fleet_lean"
    if dst.exists():
        return
    dst.mkdir(parents=True)
    for p in list(MODELS_DIR.glob("02H*.joblib")) + [MODELS_DIR / "thresholds.json"]:
        if p.exists():
            shutil.copy2(p, dst / p.name)


def run(stations, n_iter):
    OUT.mkdir(parents=True, exist_ok=True)
    backup_lean()
    g = load_gauges()
    stations = stations or list(g.index)
    daily = choose_daily(stations)
    hourly = choose_hourly(stations)
    prev = pd.read_csv(RESULTS_DIR / "fleet_results.csv", dtype={"station": str}).set_index("station")

    print("\n=== Model B steps 2-4: RATE features, set comparison, re-tune, thresholds, TEST once ===")
    cleaned, comps, rows, abl_rows, imp_rows, coef_rows, preds = {}, [], [], [], [], [], {}
    thresholds, capacity, features = {}, {}, {}
    for st in stations:
        t0 = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            df = clean.clean_station(st, rain_frame(daily[st]["climate_id"]))
        cleaned[st] = df
        hid = hourly[st]["climate_id"] if hourly.get(st) else None
        d, X, sets, stats, cap_tab, cap_reason = prepare(st, df, hid)
        sp = d["split"]
        print(f"\n  {st} {g.loc[st, 'name'][:40]} | hourly: {hid or 'SKIPPED'} | capacity "
              f"({stats['rate_var']}): {('%.2f mm' % stats['capacity']) if stats['capacity'] else 'NOT estimated - ' + cap_reason}")
        if cap_tab is not None:
            ct = cap_tab.reset_index(drop=True)
            print("    capacity bins (TRAIN): " + "; ".join(
                f"[{r.lower:.1f}-{r.upper:.1f}] {int(r.days)}d {int(r.positives)}pos {r.rate_next_day_high:.2f}"
                for r in ct.itertuples()))
        capacity[st] = dict(rate_var=stats["rate_var"], capacity=stats["capacity"],
                            status="ok" if stats["capacity"] else cap_reason,
                            median_train_antecedent_7d=stats["median_train_ant7"],
                            bins=None if cap_tab is None else cap_tab.reset_index(drop=True).round(4).to_dict("records"))
        t, best, chosen, reason, fitted = compare(st, d, X, sets)
        comps.append(t)
        for s_, r in best.iterrows():
            print(f"    {s_:<15} {int(r.n_features):2d} feat  best {r.model:<6} CV PR-AUC {r.cv_pr_auc:.3f} +/- {r.cv_std:.3f}"
                  f"  val PR-AUC {r.val_pr_auc:.3f}  val F2 {r.val_f2:.3f}")
        print(f"    DECISION: {chosen} - {reason}")

        # LR coefficients of the new features (standardised), from the largest set's logistic regression
        big = [s_ for s_ in SET_ORDER if s_ in sets][-1]
        lr = fitted[(big, "logreg")].named_steps["model"]
        for f, c in zip(sets[big], lr.coef_[0]):
            if f in NEW:
                coef_rows.append(dict(station=st, set=big, feature=f, coef_standardised=c))

        # step 4: four models on the chosen set
        cols = sets[chosen]
        d2 = {**d, "X": X[cols], "cols": cols}
        _, cands, bestm, warning, rule, _ = fleet.fit_station(st, df, n_iter, d=d2)
        c = cands[bestm]
        Xte, yte = X.loc[sp == "test", cols], d["y"][sp == "test"].to_numpy()
        dte = X.index[sp == "test"]
        p_te = c["pipe"].predict_proba(Xte)[:, 1]
        ev = lambda p, cut: events(dte, yte, (p >= cut).astype(int), "next")
        w, wr = fleet.score(dte, yte, p_te, c["watch"]), fleet.score(dte, yte, p_te, warning)
        n_ev, _, before = ev(p_te, c["watch"])
        pers = d["persist"][sp == "test"].to_numpy()
        ps = fleet.score(dte, yte, pers, 0.5)
        cnt = {s_: int(d["y"][sp == s_].sum()) for s_ in ("val", "test")}
        usable = cnt["val"] >= fleet.MIN_POS and cnt["test"] >= fleet.MIN_POS
        ureason = "ok" if usable else (f"too few high-water events to validate: val {cnt['val']}, test {cnt['test']} "
                                       f"positive days (need >= {fleet.MIN_POS} in each); run `python -m src.diagnose {st}`")
        pv = prev.loc[st] if st in prev.index else None
        rows.append(dict(station=st, name=g.loc[st, "name"], usable=usable, feature_set=chosen, model=bestm,
                         n_features=len(cols), hourly_station=hid or "SKIPPED", test_pos_days=int(yte.sum()),
                         pr_auc=average_precision_score(yte, p_te), cv_pr_auc=c["cv"][0], cv_std=c["cv"][1],
                         precision=w["precision"], recall=w["recall"], f2=w["f2"],
                         events=f"{w['events_caught']}/{w['events']}", day_before=f"{before}/{n_ev}",
                         warning_precision=wr["precision"], warning_recall=wr["recall"],
                         warning_events=f"{wr['events_caught']}/{wr['events']}",
                         persist_f2=ps["f2"], persist_events=f"{ps['events_caught']}/{ps['events']}",
                         lean_model=None if pv is None else pv["model"],
                         lean_pr_auc=None if pv is None else pv["pr_auc"],
                         lean_f2=None if pv is None else pv["watch_f2"],
                         lean_events=None if pv is None else pv["watch_events"], decision=reason))
        print(f"    final: {bestm} on {chosen}; WATCH {c['watch']:.4f}, WARNING {warning:.4f} ({rule}); "
              f"TEST PR-AUC {rows[-1]['pr_auc']:.3f}, F2 {w['f2']:.3f}, events {rows[-1]['events']} "
              f"(LEAN before: PR-AUC {rows[-1]['lean_pr_auc']:.3f}, F2 {rows[-1]['lean_f2']:.3f}, "
              f"events {rows[-1]['lean_events']}) [{time.time() - t0:.0f}s]")

        a = ablation(d, X, sets, chosen, bestm, c["params"])
        if a:
            abl_rows.append(dict(station=st, model=bestm, base_set=chosen,
                                 **{f"{k}_{m}": v[m] for k, v in a.items() for m in ("cv", "cv_std", "val", "test")}))
        else:
            abl_rows.append(dict(station=st, model=bestm, base_set=chosen, note="no hourly rain: intensity SKIPPED"))
        for f, v in importances(c["pipe"], bestm, cols).items():
            imp_rows.append(dict(station=st, model=bestm, feature=f, share=v, new_feature=f in NEW))

        thresholds[st] = dict(model=bestm, feature_set=chosen, usable=usable, usable_reason=ureason,
                              watch=c["watch"], warning=warning, warning_rule=rule, level_threshold_m=d["thr"],
                              lat=float(g.loc[st, "lat"]), lon=float(g.loc[st, "lon"]),
                              rain_station=daily[st]["climate_id"], rain_km=daily[st]["km"],
                              hourly_station=hid, hourly_km=hourly[st]["km"] if hid else None, decision=reason)
        features[st] = dict(feature_set=chosen, features=cols)
        joblib.dump(dict(pipeline=c["pipe"], model=bestm, features=cols, feature_set=chosen, station=st,
                         level_threshold=d["thr"], watch=c["watch"], warning=warning, rain_station=daily[st]["climate_id"],
                         hourly_station=hid, stats=stats, params=c["params"],
                         split_dates=(str(d["tr_end"].date()), str(d["va_end"].date())),
                         train_period=(str(X.index[sp == "train"].min().date()), str(d["tr_end"].date()))),
                    MODELS_DIR / f"{st}.joblib")
        preds[st] = pd.DataFrame({"p": c["pipe"].predict_proba(X[cols])[:, 1], "y": d["y"], "split": sp})

    res = pd.DataFrame(rows)
    res.to_csv(RESULTS_DIR / "modelb_results.csv", index=False)
    pd.concat(comps).to_csv(OUT / "set_comparison.csv", index=False)
    pd.DataFrame(abl_rows).to_csv(OUT / "intensity_ablation.csv", index=False)
    pd.DataFrame(imp_rows).to_csv(OUT / "importances.csv", index=False)
    pd.DataFrame(coef_rows).to_csv(OUT / "logreg_new_feature_coefs.csv", index=False)
    pd.concat({s: p for s, p in preds.items()}, names=["station", "date"]).to_csv(OUT / "predictions.csv")
    (MODELS_DIR / "thresholds.json").write_text(json.dumps(thresholds, indent=2))
    (MODELS_DIR / "capacity.json").write_text(json.dumps(capacity, indent=2, default=float))
    (MODELS_DIR / "features.json").write_text(json.dumps(features, indent=2))
    report(res, pd.DataFrame(abl_rows), pd.DataFrame(imp_rows), pd.DataFrame(coef_rows))
    return cleaned, preds, thresholds, res


def report(res, abl, imp, coefs):
    print("\n=== Model B results on TEST (cut-offs fixed on validation) vs the previous LEAN fleet ===")
    cols = ["station", "usable", "feature_set", "model", "test_pos_days", "precision", "recall", "f2", "pr_auc",
            "cv_pr_auc", "cv_std", "events", "day_before", "persist_f2", "persist_events", "lean_model", "lean_f2",
            "lean_pr_auc", "lean_events"]
    with pd.option_context("display.width", 300, "display.max_columns", 30):
        print(res[cols].round(3).to_string(index=False))
    sw = res[res.feature_set != "LEAN"]
    print(f"  switched away from LEAN at {len(sw)}/{len(res)} gauges: {list(sw.station)}")
    print("  NOTE: test splits hold few events; differences of a few hundredths are within noise (see cv_std).")
    print("\n=== Rain-rate ablation: same model and params, with vs without the intensity features ===")
    with pd.option_context("display.width", 300, "display.max_columns", 30):
        print(abl.round(3).fillna("").to_string(index=False))
    print("\n=== Top new-feature importances in each final model (share of total) ===")
    new = imp[imp.new_feature]
    print(new.groupby("station").apply(lambda x: ", ".join(f"{f}={v:.3f}" for f, v in zip(x.feature, x.share)),
                                       include_groups=False).to_string() if len(new) else "  none in any top-15")
    print("\n=== Logistic regression (largest set) standardised coefficients of the new features ===")
    print(coefs.pivot_table(index="station", columns="feature", values="coef_standardised").round(3).to_string())


def compare_loo(before_csv, after_csv):
    b, a = pd.read_csv(before_csv), pd.read_csv(after_csv)
    print("\n=== Combiner leave-one-out: LEAN fleet (before) vs Model B (after), mean PR-AUC over gauges ===")
    rows = []
    for R in sorted(a.R.unique()):
        for m in ("raw", "own", "mean_all", "nearest"):
            bb = b[(b.R == R) & (b.method == m)]
            aa = a[(a.R == R) & (a.method == m)]
            common = sorted(set(bb.gauge) & set(aa.gauge))
            rows.append(dict(R=R, method=m, gauges=len(common),
                             before=bb.set_index("gauge").loc[common, "pr_auc"].mean(),
                             after=aa.set_index("gauge").loc[common, "pr_auc"].mean()))
    t = pd.DataFrame(rows)
    t["change"] = t["after"] - t["before"]
    print(t.round(3).to_string(index=False))
    t.to_csv(OUT / "loo_before_after.csv", index=False)
    return t
