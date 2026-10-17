"""Write models/model_card.md from the Model B run outputs (every number comes from the result files).

python -m src.model_card
"""
import json

import joblib
import pandas as pd

from .config import MODELS_DIR, RESULTS_DIR

OUT = RESULTS_DIR / "modelb"


def main():
    res = pd.read_csv(RESULTS_DIR / "modelb_results.csv", dtype={"station": str})
    th = json.loads((MODELS_DIR / "thresholds.json").read_text())
    cap = json.loads((MODELS_DIR / "capacity.json").read_text())
    loo = pd.read_csv(OUT / "loo_results.csv")
    lines = [
        "# Model card: FloodSense Model B",
        "",
        "**Purpose.** For each of 11 Water Survey of Canada gauges in the Toronto area, estimate the probability that "
        "the gauge's daily mean level will be above its own high-water mark **tomorrow**, and turn it into "
        "NONE / WATCH / WARNING. A distance-weighted combiner (`floodrisk.risk_at`) turns gauge probabilities into a "
        "risk at a MedMesh relay location. It is a decision aid for routing and relay alerts, not a flood forecast "
        "for streets or buildings.",
        "",
        "**Label.** y(t) = 1 if LEVEL(t+1) > the 95th percentile of LEVEL over that gauge's TRAIN period. LEVEL is a "
        "gauge height above a local datum (not water depth), daily mean, local standard time.",
        "",
        "**Data sources.**",
        "- **Water levels and discharge:** ECCC Water Survey of Canada daily files and realtime 5-minute data (GeoMet API).",
        "- **Daily rain:** the nearest ECCC climate station with >= 90% coverage of the gauge's period. Toronto Pearson is two climate IDs combined.",
        "- **Hourly rain:** ECCC `climate-hourly` PRECIP_AMOUNT, nearest station with <= 30% missing hours and <= 25 km away. Only Toronto City (6158355) qualified; Pearson and Buttonville publish no hourly precipitation.",
        "",
        "**Method.**",
        "- **Split:** chronological 70/15/15 per gauge.",
        "- **Feature sets compared:** LEAN (level/discharge trends + daily rain + season) against LEAN + rain-intensity, + drainage proxies, + net rain-minus-capacity features.",
        "- **Set choice:** the richer set is kept only if it beats LEAN in cross-validation on train by more than one fold std AND validation PR-AUC does not drop.",
        "- **Models:** LogisticRegression, RandomForest, LightGBM and XGBoost, tuned on TRAIN with TimeSeriesSplit(5, gap=3) scored on average precision. The best is chosen on VALIDATION PR-AUC / F2.",
        "- **Thresholds:** WATCH = F2-optimal on validation. WARNING = the lowest cut-off with >= 50% validation precision, else F0.5-optimal, never below WATCH.",
        "- **Test:** scored once with those fixed cut-offs.",
        "",
        "**The drainage features are proxies, not measured drainage.** They are antecedent rain, recession rate, discharge change, headroom below the high-water mark, and a \"capacity\" read off train-period bins.",
        "",
        "## Per gauge",
        "",
        "| Gauge | Usable | Feature set | Model | Train period | Daily rain | Hourly rain | Capacity | Test high days | "
        "Precision | Recall | F2 | PR-AUC (CV ± std) | Events caught | Flagged day before |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for _, r in res.iterrows():
        b = joblib.load(MODELS_DIR / f"{r.station}.joblib")
        t = th[r.station]
        c = cap[r.station]
        cap_txt = f"{c['capacity']:.1f} mm ({c['rate_var']})" if c["capacity"] else "not estimated"
        hourly = f"{t['hourly_station']} ({t['hourly_km']} km)" if t.get("hourly_station") else "skipped"
        lines.append(f"| {r.station} {r['name'].title()[:28]} | {'yes' if r.usable else '**no**'} | {r.feature_set} | "
                     f"{r.model} | {b['train_period'][0]} – {b['train_period'][1]} | {t['rain_station']} "
                     f"({t['rain_km']} km) | {hourly} | {cap_txt} | {r.test_pos_days} | {r.precision:.2f} | "
                     f"{r.recall:.2f} | {r.f2:.2f} | {r.pr_auc:.3f} ({r.cv_pr_auc:.3f} ± {r.cv_std:.3f}) | "
                     f"{r.events} | {r.day_before} |")
    raw = loo[loo.method == "raw"].groupby("R")["pr_auc"].mean()
    own = loo[loo.method == "own"].groupby("R")["pr_auc"].mean()
    lines += [
        "",
        "Metrics are on each gauge's TEST split at the WATCH cut-off. Test splits hold 17–48 events, so differences "
        "of a few hundredths are within noise.",
        "",
        "## Combiner",
        "",
        "**The formula:**",
        "- **Weights:** `w = 1 / max(d, 1 km)^2` (haversine). Gauges beyond R = 15 km are ignored.",
        "- **Combined risk:** `max(nearest gauge p, weighted mean p)`.",
        "- **No gauge within R:** null (\"no gauge nearby\").",
        "- **Exclusions:** gauges with `usable = false` are skipped.",
        "",
        "**Leave-one-gauge-out test, mean PR-AUC over gauges:**",
        "",
        "| R | Combiner from neighbours | Gauge's own model |",
        "|---|---|---|",
    ] + [f"| {R} km | {raw[R]:.3f} | {own[R]:.3f} |" for R in raw.index] + [
        "",
        "Neighbours recover part of a gauge's skill, not all of it.",
        "",
        "## Known limitations",
        "",
        "- **Gauge-based proxy label:** creek high water at a gauge, not street, basement or road flooding.",
        "- **Daily resolution:** a next-24-hours model. Sub-daily flash peaks are averaged, and same-day storms are not visible to the day-before forecast.",
        "- **Drainage is estimated, not measured.** Capacity comes from train-period bins and could not be estimated where no rain bin reached a 30% next-day high-water rate.",
        "- **Rain comes from the nearest climate station, which may be far:**",
        "  - Daily rain is up to 20.9 km away (Highland, Rouge).",
        "  - Hourly rain is from one downtown station (Toronto City), up to 20.9 km away.",
        "  - East Humber and Rouge have no hourly rain.",
        "- **Several gauges end in 2023** (Etobicoke, Don at Todmorden, Highland, West Highland).",
        "- **Cooksville (02HB030) is `usable = false`:** too few validation/test events after a stage–discharge shift and a 2014–2021 discharge gap (`python -m src.diagnose 02HB030`).",
        "- **The combiner is validated only by leave-one-gauge-out**, not against street-level labels.",
        "- **Live inputs can be incomplete:** live rain is fetched from ECCC and can lag a day. Missing inputs are imputed with train medians and listed in `imputed`.",
    ]
    (MODELS_DIR / "model_card.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {MODELS_DIR / 'model_card.md'}")


if __name__ == "__main__":
    main()
