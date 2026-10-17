"""Step 5: model pipelines and search spaces."""
import numpy as np
from lightgbm import LGBMClassifier
from scipy.stats import loguniform, randint, uniform
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from .config import RANDOM_STATE

MODEL_NAMES = ["logreg", "rf", "lgbm", "xgb"]
TREE_MODELS = ["rf", "lgbm", "xgb"]
# lower = simpler; used to break ties
SIMPLICITY = {"always_no": 0, "persistence": 1, "logreg": 2, "rf": 3, "lgbm": 4, "xgb": 4}


def make_pipeline(name: str, params: dict | None = None) -> Pipeline:
    imp = ("impute", SimpleImputer(strategy="median"))   # only rain can be NaN; fit on train inside the pipeline
    if name == "logreg":
        steps = [imp, ("scale", StandardScaler()),
                 ("model", LogisticRegression(max_iter=5000, random_state=RANDOM_STATE))]
    elif name == "rf":
        steps = [imp, ("model", RandomForestClassifier(n_estimators=300, random_state=RANDOM_STATE, n_jobs=1))]
    elif name == "lgbm":
        steps = [imp, ("model", LGBMClassifier(subsample_freq=1, random_state=RANDOM_STATE, n_jobs=1, verbose=-1))]
    elif name == "xgb":
        steps = [imp, ("model", XGBClassifier(random_state=RANDOM_STATE, n_jobs=1, eval_metric="logloss"))]
    else:
        raise ValueError(name)
    pipe = Pipeline(steps)
    if params:
        pipe.set_params(**params)
    return pipe


def search_space(name: str, neg_pos: float) -> dict:
    spw = [1.0, neg_pos]
    if name == "logreg":
        return {"model__C": loguniform(1e-3, 1e2), "model__class_weight": [None, "balanced"]}
    if name == "rf":
        return {"model__n_estimators": [200, 300, 500], "model__max_depth": [None, 4, 6, 8],
                "model__min_samples_leaf": [1, 3, 5, 10], "model__class_weight": ["balanced", "balanced_subsample"]}
    if name == "lgbm":
        return {"model__n_estimators": randint(200, 801), "model__learning_rate": loguniform(0.01, 0.2),
                "model__num_leaves": [7, 15, 31], "model__min_child_samples": [5, 10, 20],
                "model__subsample": uniform(0.6, 0.4), "model__colsample_bytree": uniform(0.6, 0.4),
                "model__scale_pos_weight": spw}
    if name == "xgb":
        return {"model__n_estimators": randint(200, 801), "model__learning_rate": loguniform(0.01, 0.2),
                "model__max_depth": [2, 3, 4, 6], "model__min_child_weight": [1, 3, 5],
                "model__subsample": uniform(0.6, 0.4), "model__colsample_bytree": uniform(0.6, 0.4),
                "model__scale_pos_weight": spw}
    raise ValueError(name)


def to_jsonable(p: dict) -> dict:
    return {k: (v.item() if isinstance(v, np.generic) else v) for k, v in p.items()}
