"""Fleet step 2: the shipped binary recipe (NEXT-DAY, p95, LEAN + rain) for every gauge.

Per station: train-only p95 threshold, chronological 70/15/15 split, four models tuned on TRAIN with
TimeSeriesSplit(5, gap=3) / average_precision, best model by VALIDATION PR-AUC (ties within 0.01 -> F2 ->
simpler). Alert thresholds from VALIDATION:
  WATCH   = F2-optimal cut-off
  WARNING = lowest cut-off with >= 50% precision (if none: F0.5-optimal); never below WATCH.
Test is scored once with those fixed cut-offs.
"""
import contextlib
import io
import json
import time
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, fbeta_score, precision_score, recall_score

from . import clean
from .combine import alert_level
from .config import FLEET_PCT, MODELS_DIR, RESULTS_DIR
from .evaluate import best_f2_threshold
from .experiments import events, tune
from .features import build_frame, drop_constant, feature_sets
from .gauges import load_gauges
from .label import label, persistence, split_dates, threshold, usable_rows
from .models import MODEL_NAMES, SIMPLICITY, make_pipeline
from .rain_gauges import choose_all, rain_frame

warnings.filterwarnings("ignore", category=UserWarning)
OUT = RESULTS_DIR / "fleet"
QUALITY = {"Ice Conditions", "Estimated"}
LEVELS = ("NONE", "WATCH", "WARNING")
MIN_POS = 10          # quality gate: a gauge needs >= 10 positive days in BOTH val and test to be usable


def warning_threshold(y, p, watch, min_precision=0.5):
    """Lowest cut-off with precision >= 50% on validation; else F0.5-optimal. Clamped to >= WATCH."""
    rule = None
    for t in np.unique(p):                       # ascending
        pred = (p >= t).astype(int)
        if pred.sum() and precision_score(y, pred, zero_division=0) >= min_precision:
            rule = f"lowest cut-off with >= {int(min_precision * 100)}% val precision"
            break
    if rule is None:
        best_f = -1.0
        for c in np.unique(p):
            f = fbeta_score(y, (p >= c).astype(int), beta=0.5, zero_division=0)
            if f >= best_f:
                t, best_f = float(c), f
        rule = "no cut-off reached 50% val precision -> F0.5-optimal"
    if t < watch:
        return float(watch), rule + " (raised to WATCH)"
    return float(t), rule


def build(station, df):
    tr_end, va_end = split_dates(df)
    thr = threshold(df.loc[:tr_end, "LEVEL"], FLEET_PCT)
    F = build_frame(df, thr, use_snow=False)
    y = label(df, "next", thr)
    rows = usable_rows(df, "next") & y.notna()
    F, y = F[rows], y[rows].astype(int)
    split = np.where(F.index <= tr_end, "train", np.where(F.index <= va_end, "val", "test"))
    cols, dropped = drop_constant(feature_sets("next", True, False)["LEAN"], F[split == "train"])
    if dropped:
        print(f"    dropped constant columns {dropped}")
    # quality symbol on the HIGH day itself (t+1)
    sym = (df["DISCHARGE_SYMBOL_EN"].isin(QUALITY) | df["LEVEL_SYMBOL_EN"].isin(QUALITY)).shift(-1)
    return dict(X=F[cols], y=y, split=split, cols=cols, thr=thr, persist=persistence(df, "next", thr)[rows],
                quality=sym[rows].fillna(False).astype(bool), tr_end=tr_end, va_end=va_end)


def fit_station(station, df, n_iter, d=None):
    t0 = time.time()
    d = d or build(station, df)
    sp, X, y = d["split"], d["X"], d["y"]
    Xtr, ytr = X[sp == "train"], y[sp == "train"]
    Xva, yva = X[sp == "val"], y[sp == "val"].to_numpy()
    neg_pos = float((ytr == 0).sum() / max(ytr.sum(), 1))
    cands = {}
    for name in MODEL_NAMES:
        params, m, s, _ = tune(name, Xtr, ytr, neg_pos, n_iter)
        pipe = make_pipeline(name, params or None).fit(Xtr, ytr)
        p_va = pipe.predict_proba(Xva)[:, 1]
        watch, f2 = best_f2_threshold(yva, p_va)
        cands[name] = dict(pipe=pipe, params=params, cv=(m, s), val_ap=average_precision_score(yva, p_va),
                           val_f2=f2, watch=watch)
    v = pd.DataFrame([dict(model=n, ap=c["val_ap"], f2=c["val_f2"]) for n, c in cands.items()])
    tied = v[v.ap >= v.ap.max() - 0.01]
    tied = tied[tied.f2 >= tied.f2.max() - 0.01]
    best = tied.assign(s=tied.model.map(SIMPLICITY)).sort_values(["s", "ap"], ascending=[True, False]).iloc[0].model
    c = cands[best]
    p_va = c["pipe"].predict_proba(Xva)[:, 1]
    warning, rule = warning_threshold(yva, p_va, c["watch"])
    return d, cands, best, warning, rule, time.time() - t0


def score(dates, y, p, cut):
    pred = (p >= cut).astype(int)
    n, caught, _ = events(dates, y, pred, "next")
    return dict(precision=precision_score(y, pred, zero_division=0), recall=recall_score(y, pred, zero_division=0),
                f2=fbeta_score(y, pred, beta=2, zero_division=0), events_caught=caught, events=n)


def run(stations, n_iter, models_dir=MODELS_DIR / "fleet_lean"):
    """LEAN-only fleet (the pre-Model-B baseline). Writes its models to models/fleet_lean/."""
    OUT.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    g = load_gauges()
    stations = stations or list(g.index)
    choice = choose_all(stations)
    missing = [s for s in stations if s not in choice]
    if missing:
        raise SystemExit(f"No climate station with enough coverage for {missing}; stopping.")

    print("\n=== STEP 2 (fleet): clean + per-station models (NEXT-DAY, train p95, LEAN + rain) ===")
    cleaned, rows, thresholds, preds = {}, [], {}, {}
    for st in stations:
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            df = clean.clean_station(st, rain_frame(choice[st]["climate_id"]))
        cleaned[st] = df
        d, cands, best, warning, rule, secs = fit_station(st, df, n_iter)
        c = cands[best]
        sp = d["split"]
        cnt = {s: (int((sp == s).sum()), int(d["y"][sp == s].sum())) for s in ("train", "val", "test")}
        print(f"\n  {st} {g.loc[st, 'name'][:40]} | rain {choice[st]['climate_id']} ({choice[st]['km']} km) | "
              f"p95 LEVEL > {d['thr']:.3f} m | train<= {d['tr_end'].date()} val<= {d['va_end'].date()} | "
              f"rows/positives train {cnt['train']} val {cnt['val']} test {cnt['test']}")
        usable = cnt["val"][1] >= MIN_POS and cnt["test"][1] >= MIN_POS
        reason = "ok" if usable else (
            f"too few high-water events to validate: val {cnt['val'][1]}, test {cnt['test'][1]} positive days "
            f"(need >= {MIN_POS} in each); run `python -m src.diagnose {st}` for the data causes")
        for s in ("val", "test"):
            if cnt[s][1] < MIN_POS:
                print(f"    !!!!! WARNING: {s} has only {cnt[s][1]} positive days (<{MIN_POS}) !!!!!")
        if not usable:
            print(f"    !!!!! {st} marked usable=false: excluded from the combiner and the leave-one-out test !!!!!")
        print("    val PR-AUC / F2: " + ", ".join(f"{n} {cands[n]['val_ap']:.3f}/{cands[n]['val_f2']:.3f}"
                                                 for n in MODEL_NAMES) + f" -> best {best} ({secs:.0f}s)")
        print(f"    WATCH = {c['watch']:.4f} (F2-optimal on val); WARNING = {warning:.4f} ({rule})")

        # test, once, with fixed cut-offs
        Xte, yte = d["X"][sp == "test"], d["y"][sp == "test"].to_numpy()
        dte = d["X"].index[sp == "test"]
        p_te = c["pipe"].predict_proba(Xte)[:, 1]
        w, wr = score(dte, yte, p_te, c["watch"]), score(dte, yte, p_te, warning)
        pers = d["persist"][sp == "test"].to_numpy()
        ps = score(dte, yte, pers, 0.5)
        q = d["quality"]
        pos = d["y"] == 1
        rows.append(dict(station=st, name=g.loc[st, "name"], model=best, usable=usable,
                         rain_station=choice[st]["climate_id"],
                         rain_km=choice[st]["km"], test_start=str(dte.min().date()), test_end=str(dte.max().date()),
                         test_pos_days=int(yte.sum()), pr_auc=average_precision_score(yte, p_te),
                         cv_pr_auc=c["cv"][0], cv_std=c["cv"][1],
                         watch_precision=w["precision"], watch_recall=w["recall"], watch_f2=w["f2"],
                         watch_events=f"{w['events_caught']}/{w['events']}",
                         warning_precision=wr["precision"], warning_recall=wr["recall"],
                         warning_events=f"{wr['events_caught']}/{wr['events']}",
                         persist_precision=ps["precision"], persist_recall=ps["recall"], persist_f2=ps["f2"],
                         persist_events=f"{ps['events_caught']}/{ps['events']}",
                         pos_days_quality_symbol=f"{int((q & pos).sum())}/{int(pos.sum())}",
                         test_pos_quality_symbol=f"{int((q & pos)[sp == 'test'].sum())}/{int(yte.sum())}"))
        thresholds[st] = dict(model=best, usable=usable, usable_reason=reason, watch=c["watch"], warning=warning, warning_rule=rule,
                              level_threshold_m=d["thr"], lat=float(g.loc[st, "lat"]), lon=float(g.loc[st, "lon"]),
                              rain_station=choice[st]["climate_id"], rain_km=choice[st]["km"])
        joblib.dump(dict(pipeline=c["pipe"], model=best, features=d["cols"], level_threshold=d["thr"],
                         watch=c["watch"], warning=warning, station=st, rain_station=choice[st]["climate_id"],
                         params=c["params"], split_dates=(str(d["tr_end"].date()), str(d["va_end"].date()))),
                    models_dir / f"{st}.joblib")
        # out-of-train predictions for every usable row (val + test), used by the combiner test
        p_all = pd.Series(c["pipe"].predict_proba(d["X"])[:, 1], index=d["X"].index)
        preds[st] = pd.DataFrame({"p": p_all, "y": d["y"], "split": sp})

    table = pd.DataFrame(rows)
    table.to_csv(RESULTS_DIR / "fleet_results.csv", index=False)
    (models_dir / "thresholds.json").write_text(json.dumps(thresholds, indent=2))
    pd.concat({s: p for s, p in preds.items()}, names=["station", "date"]).to_csv(OUT / "predictions.csv")
    print_table(table)
    return cleaned, preds, thresholds, table


def print_table(t):
    print("\n=== Fleet results on TEST (WATCH/WARNING cut-offs fixed on validation) ===")
    show = t[["station", "model", "usable", "test_pos_days", "pr_auc", "cv_pr_auc", "cv_std", "watch_precision",
              "watch_recall", "watch_f2", "watch_events", "warning_precision", "warning_recall", "warning_events",
              "persist_precision", "persist_recall", "persist_f2", "persist_events", "pos_days_quality_symbol",
              "test_pos_quality_symbol"]].copy()
    with pd.option_context("display.width", 300, "display.max_columns", 30):
        print(show.round(3).to_string(index=False))
    low = t[t.test_pos_days < MIN_POS]
    if len(low):
        print(f"  !!!!! WARNING: fewer than {MIN_POS} positive test days at {list(low.station)} !!!!!")
    bad = t[~t.usable]
    if len(bad):
        print(f"  !!!!! usable=false (val or test < {MIN_POS} positive days): {list(bad.station)}; their test metrics "
              f"are not meaningful and they are left out of the combiner !!!!!")
    print("  pos_days_quality_symbol = high-water (label) days carrying 'Ice Conditions' or 'Estimated', all splits; "
          "test_pos_quality_symbol = same, test only.")
    print("  NOTE: test splits hold few events; differences of a few hundredths are within noise (see cv_std).")


def known_floods(cleaned, preds, thresholds, dates=("2013-07-08", "2024-07-16", "2024-08-17"), out=OUT):
    print("\n=== Known-flood check (alert level = WATCH/WARNING from the station's own model) ===")
    rows = []
    for st, pr in preds.items():
        df, th = cleaned[st], thresholds[st]
        for ds in dates:
            day = pd.Timestamp(ds)
            r = dict(station=st, date=ds)
            if day < df.index.min() or day > df.index.max():
                r["status"] = f"not covered (data {df.index.min().date()}..{df.index.max().date()})"
                rows.append(r)
                continue
            lv = df["LEVEL"].get(day)
            r["level_m"] = None if pd.isna(lv) else round(float(lv), 3)
            r["high_that_day"] = None if pd.isna(lv) else bool(lv > th["level_threshold_m"])
            for tag, issue in (("issued_day_before", day - pd.Timedelta(days=1)), ("issued_on_day", day)):
                if issue in pr.index:
                    p = float(pr.loc[issue, "p"])
                    r[tag] = f"{alert_level(p, th['watch'], th['warning'])} (p={p:.2f}, {pr.loc[issue, 'split']})"
                else:
                    r[tag] = "no usable row"
            r["split_of_day"] = pr.loc[day, "split"] if day in pr.index else "-"
            if r["split_of_day"] == "train":
                r["status"] = "TRAIN split - not evidence"
            rows.append(r)
    kf = pd.DataFrame(rows)
    with pd.option_context("display.width", 250, "display.max_columns", 20, "display.max_colwidth", 60):
        print(kf.fillna("").to_string(index=False))
    print("  'issued_day_before' = forecast made on D-1 for day D; 'issued_on_day' = forecast made on D for D+1.")
    print("  Days in a gauge's TRAIN split were fitted on and do not count as evidence.")
    kf.to_csv(out / "known_flood_check.csv", index=False)
    return kf
