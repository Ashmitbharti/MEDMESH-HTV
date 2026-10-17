"""Step 5: RandomizedSearchCV on the TRAIN split only. Validation and test never enter this module."""
import time
import warnings

import pandas as pd
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit, cross_validate

from .config import CV_GAP, CV_SPLITS, RANDOM_STATE
from .models import MODEL_NAMES, make_pipeline, search_space, to_jsonable

MIN_GAIN = 0.01
warnings.filterwarnings("ignore", message=".*No positive class found in y_true.*")


def tscv():
    return TimeSeriesSplit(n_splits=CV_SPLITS, gap=CV_GAP)


def tune_station(sp, n_iter: int, out_dir):
    X, y = sp.X["train"], sp.y["train"]
    pos = [int(y.iloc[te].sum()) for _, te in tscv().split(X)]
    print(f"  tuning on TRAIN only: {len(y)} rows, {int(y.sum())} positives; CV test-fold positives {pos}; n_iter={n_iter}")
    if min(pos) < 5:
        print("  !!! WARNING: a CV fold has < 5 positives; that fold's PR-AUC is very noisy !!!")
    rows, best = [], {}
    t_all = time.time()
    for name in MODEL_NAMES:
        t0 = time.time()
        d = cross_validate(make_pipeline(name), X, y, cv=tscv(), scoring="average_precision", n_jobs=-1)
        rs = RandomizedSearchCV(make_pipeline(name), search_space(name, sp.neg_pos), n_iter=n_iter,
                                scoring="average_precision", cv=tscv(), random_state=RANDOM_STATE,
                                n_jobs=-1, refit=False)
        rs.fit(X, y)
        res = pd.DataFrame(rs.cv_results_)
        res.to_csv(out_dir / f"tuning_results_{name}.csv", index=False)
        d_mean, d_std = d["test_score"].mean(), d["test_score"].std()
        t_mean, t_std = rs.best_score_, res["std_test_score"][rs.best_index_]
        keep_default = (t_mean - d_mean) < MIN_GAIN
        best[name] = {} if keep_default else to_jsonable(rs.best_params_)
        rows.append(dict(model=name, default_cv_pr_auc=d_mean, default_std=d_std, tuned_cv_pr_auc=t_mean,
                         tuned_std=t_std, gain=t_mean - d_mean, kept="default" if keep_default else "tuned",
                         seconds=round(time.time() - t0, 1)))
    table = pd.DataFrame(rows)
    table.to_csv(out_dir / "default_vs_tuned.csv", index=False)
    print(table.round(4).to_string(index=False))
    for r in rows:
        if r["kept"] == "default":
            print(f"    {r['model']}: tuning gained {r['gain']:+.4f} (< {MIN_GAIN}) -> keeping default params")
    print(f"  tuning time: {time.time() - t_all:.0f}s")
    return table, best
