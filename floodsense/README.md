# FloodSense

FloodSense gives MedMesh a **creek high-water risk** score: will a gauge's daily mean level be above its own train-period 95th percentile tomorrow?

**Model B** is the current package. It covers **11 Water Survey of Canada gauges**, each with its own model. For every gauge it tested a **rain-rate vs drainage ("RATE")** feature set against the shipped LEAN set and kept whichever won by the rules below. A **distance-weighted combiner** (`floodrisk.risk_at`) turns gauge probabilities into a risk at any relay location.

Further down this file: the earlier LEAN-only fleet, whose artifacts are now in `models/fleet_lean/`, and the 3-station study (v1 / v2 / multiclass).

## How to run

```bash
python -m venv .venv                                   # Python 3.11
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python run_all.py                        # Model B: rain + hourly rain per gauge, LEAN vs RATE, models, known floods, leave-one-out (478 s here)
.venv/Scripts/python run_all.py --fast                 # same with n_iter=10
.venv/Scripts/python run_all.py --stations 02HC013,02HC058,02HC022   # limit to some gauges
.venv/Scripts/python predict_all.py                    # latest P(high tomorrow) + NONE/WATCH/WARNING per gauge (fetches recent rain)
.venv/Scripts/python predict_all.py --offline          # no network: cached rain in data/rain_live/, else imputed
.venv/Scripts/python floodrisk.py 43.775 -79.257       # combiner JSON for a relay (Scarborough Centre)
.venv/Scripts/python -m src.combine --lat 43.775 --lon -79.257 --R 10
.venv/Scripts/python predict_all.py --simulate 02HC058=99 02HC013=98   # what-if; writes results/simulated_readings.json
.venv/Scripts/python -m src.loo                        # leave-one-out only (raw vs normalised), from saved predictions
.venv/Scripts/python -m src.diagnose 02HB030           # why a gauge is usable=false
.venv/Scripts/python -m src.model_card                 # rewrite models/model_card.md from the result files
.venv/Scripts/python -m pytest tests -q                # 31 tests
.venv/Scripts/python run_all.py --fleet-lean           # the earlier LEAN-only fleet
.venv/Scripts/python run_all.py --v2 | --v1 | --multiclass   # the earlier 3-station study
```

**In the FastAPI command centre:**

```python
from floodrisk import risk_at
risk_at(43.775, -79.257)                 # reads results/latest_readings.json (written by predict_all.py)
risk_at(43.775, -79.257, refresh=True)   # recompute all gauges now
```

The returned JSON has:
- **The risk:** `combined_risk` (null when no gauge is nearby) and `alert`.
- **How it was built:** `nearest_gauge` and `driven_by`.
- **The inputs:** `gauges_used`, with distance, weight, p and reading time for each gauge.
- **Freshness:** `timestamp` and `stale`.
- **What was left out:** `excluded_unusable_gauges` (with the reason) and `unavailable_gauges`.

**Package contents (`models/`):**
- **Models:** `{station}.joblib` (11 files).
- **Thresholds and decisions:** `thresholds.json` holds WATCH/WARNING, the usable flag and its reason, rain stations, and the set decision.
- **`capacity.json`:** each gauge's capacity estimate or the reason it couldn't be estimated, with its bins.
- **`features.json`:** the exact feature list per gauge.
- **`model_card.md`.**

**Logs:** the full run is in `results/modelb_run.log`. Tables are in `results/modelb_results.csv` and `results/modelb/`.

## Model B step 1: hourly rain per gauge (`src/rain_hourly.py`)

**What exists in ECCC's `climate-hourly` collection:**
- **Columns:** these include `LOCAL_DATE`, `PRECIP_AMOUNT` and `PRECIP_AMOUNT_FLAG`. The full list is in `data/rain_hourly/<id>_columns.json`.
- **Hourly rows without hourly rain:** Pearson (both IDs) and Buttonville publish hourly rows but **no `PRECIP_AMOUNT`**. That was 0 values in every sampled July.
- **No hourly data at all:** Toronto North York.
- **Stations that do report hourly rain:**

| Station | Hourly rain | Coverage |
|---|---|---|
| Toronto City (6158355) | 2002-06 → 2025, 1-hour steps | 93.8% non-missing |
| Toronto City Centre (6158359) | from 2010 | 45–56% of hours missing over the gauge periods |
| King City North (6154150) | from 2019 | 77% missing over East Humber's period |

**The rule:**
- **Order:** try hourly-capable stations from nearest to farthest.
- **Coverage:** accept one with at most 30% missing hours over the gauge's period.
- **Distance:** stop beyond 25 km (the same limit used to warn on daily rain).

**Result:**

| Gauges | Hourly rain |
|---|---|
| Mimico, Etobicoke, Black Creek, Don West Branch, Don at Todmorden, Highland, West Highland, Cooksville, Humber at Weston | Toronto City 6158355 at 3.7–20.9 km, 84.6–98.9% of hours covered |
| **East Humber, Rouge** | **RATE: intensity features SKIPPED.** No station within 25 km reports hourly rain over their periods. Their drainage and net features use daily rain. |

Cached in `data/rain_hourly/`.

## Model B step 2: RATE features (`src/rate.py`)

All features use data up to day t only. Tests check that the hourly-derived and daily features at day t do not change when anything later is altered.

**Rain intensity** (hourly, per local day; a day needs at least 20 of 24 hours reported):
- `max_1h_rain`
- `max_3h_rain`
- `hours_with_rain`
- `rain_total_day`
- `intensity_ratio` = max_1h / (total + 0.1)

**Drainage proxies:**
- `antecedent_7d`, `antecedent_14d`: previous days' rain, today excluded.
- `recession`: median Q(t)/Q(t−1) on falling-limb days over the previous 7 days.
- `disch_chg_3d`: the 3-day change in discharge.
- `headroom`: (threshold − LEVEL) / (threshold − train median LEVEL), clipped to [−1, 2].

**Capacity**, estimated on train only:
- **Bins:** rain days (`max_1h_rain`, or daily rain where hourly is skipped) are split into quantile bins.
- **Capacity:** the lower edge of the first bin whose next-day high-water rate exceeds 0.30, with at least 15 days and 5 events in the bin.
- **Net features** when a capacity exists:
  - `rain_minus_drain`
  - `rain_over_drain`
  - `saturation_adjusted_rain` = rate × (1 + antecedent_7d / (train median antecedent_7d + 1))

**These are physics-motivated proxies, not measured drainage.**

**Capacity results (`models/capacity.json`):**

| Gauge | Capacity |
|---|---|
| Don West Branch | **13.0 mm/h** |
| East Humber | **30.4 mm/day** (daily rain) |
| Rouge | **16.0 mm/day** (daily rain) |
| The other 8 | **not estimated**: no hourly-intensity bin reached a 30% next-day high-water rate. The highest bin rates were 0.07–0.25. |

At the Highland pair and Humber at Weston, the high-water rate even *falls* in the heaviest Toronto City hourly bins. That's what you'd expect when the hourly rain is measured 10–21 km from the catchment. With no capacity there, those gauges get no net features.

Within one gauge, `rain_minus_drain` and `rain_over_drain` are just shifted or rescaled copies of the rate variable. They can only add something through `saturation_adjusted_rain` or for interpretation.

## Model B step 3: LEAN vs RATE per gauge

**How the sets were compared:**
- **Models:** logistic regression and LightGBM, fast-tuned with TimeSeriesSplit(5, gap=3) on train.
- **Scores per set:** CV PR-AUC ± fold std, then validation PR-AUC from the better of the two models.
- **Decision rule:** switch from LEAN only if the best alternative beats LEAN's CV PR-AUC by **more than one fold std** AND validation PR-AUC does not drop.

Validation F2 for every set and model is in `results/modelb/set_comparison.csv`.

Each cell is CV PR-AUC ± std / validation PR-AUC (better model).

| Gauge | LEAN | LEAN+INT | LEAN+INT+DRAIN | RATE | Decision |
|---|---|---|---|---|---|
| 02HC033 Mimico | 0.358 ± 0.046 / 0.355 (LR) | 0.352 ± 0.042 / 0.321 | 0.343 ± 0.060 / 0.342 | – (no capacity) | **LEAN**: no CV gain, val would drop |
| 02HC030 Etobicoke | 0.435 ± 0.042 / 0.447 (LGBM) | 0.433 ± 0.057 / 0.444 | 0.446 ± 0.045 / 0.413 | – | **LEAN**: +0.012 < std, val would drop |
| 02HC032 East Humber | 0.787 ± 0.088 / 0.726 (LR) | – (no hourly) | 0.786 ± 0.088 / 0.722 | 0.781 ± 0.107 / 0.720 | **LEAN** |
| 02HC027 Black Creek | 0.357 ± 0.056 / 0.262 (LGBM) | 0.384 ± 0.039 / 0.243 | 0.384 ± 0.058 / 0.324 | – | **LEAN**: +0.028 < std 0.056 |
| 02HC005 Don West Branch | 0.476 ± 0.085 / 0.507 (LR) | 0.468 ± 0.111 / 0.499 | 0.460 ± 0.109 / 0.501 | 0.460 ± 0.105 / 0.497 | **LEAN** |
| 02HC024 Don at Todmorden | 0.350 ± 0.031 / 0.325 (LGBM) | 0.350 ± 0.034 / 0.370 | 0.328 ± 0.118 / 0.372 | – | **LEAN**: CV gain 0.000 |
| 02HC013 Highland | 0.225 ± 0.023 / 0.185 (LR) | **0.294 ± 0.044 / 0.221** | 0.279 ± 0.045 / 0.257 | – | **LEAN+INT**: +0.069 > std 0.044, val up |
| 02HC058 West Highland | 0.191 ± 0.073 / 0.163 (LR) | 0.248 ± 0.069 / 0.199 | 0.242 ± 0.079 / 0.213 | – | **LEAN**: +0.057 < std 0.073 |
| 02HC022 Rouge | 0.687 ± 0.051 / 0.655 (LR) | – (no hourly) | 0.671 ± 0.061 / 0.644 | 0.675 ± 0.058 / 0.636 | **LEAN** |
| 02HB030 Cooksville | 0.205 ± 0.095 / 0.094 (LGBM) | 0.196 ± 0.087 / 0.026 | 0.181 ± 0.083 / 0.039 | – | **LEAN** (gauge unusable anyway) |
| 02HC003 Humber at Weston | 0.711 ± 0.081 / 0.716 (LR) | 0.709 ± 0.065 / 0.715 | 0.713 ± 0.050 / 0.698 | – | **LEAN**: +0.002, val would drop |

## Model B steps 4–5: final models on TEST (cut-offs fixed on validation)

All four models were retuned (n_iter=40) on each gauge's chosen set. The best was picked on validation, then WATCH (F2-optimal) and WARNING (lowest cut-off with at least 50% precision) were set on validation.

The "LEAN before" column shows model / F2 / PR-AUC / events.

| Gauge | Set | Model | Test high days | Precision | Recall | F2 | PR-AUC (CV ± std) | Events caught | Flagged day before | Persistence F2 | Persistence events | LEAN before |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02HC033 Mimico | LEAN | logreg | 59 | 0.20 | 0.73 | 0.47 | 0.367 (0.358 ± 0.046) | 39/45 | 31/45 | 0.14 | 13/45 | logreg / 0.47 / 0.367 / 39/45 |
| 02HC030 Etobicoke | LEAN | lgbm | 41 | 0.23 | 0.66 | 0.48 | 0.346 (0.464 ± 0.061) | 24/32 | 19/32 | 0.15 | 8/32 | same |
| 02HC032 East Humber | LEAN | xgb | 45 | 0.49 | 0.80 | 0.71 | 0.772 (0.803 ± 0.111) | 15/17 | 11/17 | 0.56 | 10/17 | same |
| 02HC027 Black Creek | LEAN | xgb | 65 | 0.25 | 0.74 | 0.53 | 0.414 (0.400 ± 0.061) | 38/48 | 34/48 | 0.22 | 15/48 | same |
| 02HC005 Don West Branch | LEAN | logreg | 73 | 0.49 | 0.77 | 0.69 | 0.601 (0.476 ± 0.085) | 30/33 | 19/33 | 0.44 | 21/33 | same |
| 02HC024 Don at Todmorden | LEAN | xgb | 37 | 0.21 | 0.49 | 0.39 | 0.216 (0.354 ± 0.063) | 16/32 | 13/32 | 0.14 | 3/32 | same |
| **02HC013 Highland** | **LEAN+INT** | lgbm | 34 | 0.18 | 0.59 | **0.40** | **0.237** (0.260 ± 0.063) | **20/31** | 18/31 | 0.06 | 3/31 | xgb / 0.37 / 0.203 / **23/31** |
| 02HC058 West Highland | LEAN | xgb | 34 | 0.16 | 0.47 | 0.34 | 0.162 (0.219 ± 0.060) | 15/28 | 12/28 | 0.15 | 5/28 | same |
| 02HC022 Rouge | LEAN | logreg | 60 | 0.51 | 0.78 | 0.71 | 0.635 (0.689 ± 0.054) | 31/37 | 24/37 | 0.38 | 16/37 | same |
| 02HB030 Cooksville (**unusable**) | LEAN | logreg | 2 | 0 | 0 | 0 | 0.036 (0.199 ± 0.039) | 0/2 | 0/2 | 0 | 0/2 | same |
| 02HC003 Humber at Weston | LEAN | xgb | 63 | 0.49 | 0.78 | 0.69 | 0.710 (0.690 ± 0.132) | 26/32 | 18/32 | 0.46 | 17/32 | same |

"Flagged day before" counts events where the forecast issued the day before onset was at or above WATCH.

**Where RATE helped, and where it did not:**
- **Highland Creek is the only switch** (to LEAN+INT).
  - **Better:** test PR-AUC 0.203 → 0.237 and F2 0.375 → 0.400.
  - **Worse:** events caught 23/31 → 20/31.
  - **Net:** a mixed result on a weak gauge, and within noise either way.
- **RATE did not help at the other 10 gauges.** No alternative set beat LEAN by more than one fold std. At 8 of them validation PR-AUC would also have dropped. Their final models are identical to the previous LEAN fleet: same model, cut-offs and test numbers.
- **The drainage proxies and net features never won anywhere.**

**Rain-rate ablation** (`results/modelb/intensity_ablation.csv`): the same final model and parameters, with vs without the intensity features. Each cell is CV / validation / test PR-AUC.

| Gauge | With intensity | Without intensity |
|---|---|---|
| Mimico | 0.345 / 0.344 / 0.374 | 0.358 / 0.355 / 0.367 |
| Etobicoke | 0.467 / 0.463 / 0.358 | 0.464 / 0.458 / 0.346 |
| Black Creek | 0.412 / 0.317 / 0.456 | 0.400 / 0.306 / 0.414 |
| Don West Branch | 0.468 / 0.499 / 0.600 | 0.476 / 0.507 / 0.601 |
| Don at Todmorden | 0.353 / 0.386 / 0.204 | 0.354 / 0.385 / 0.216 |
| **Highland** | **0.260 / 0.281 / 0.237** | 0.239 / 0.211 / 0.192 |
| West Highland | 0.224 / 0.230 / 0.197 | 0.219 / 0.226 / 0.162 |
| Cooksville | 0.192 / 0.069 / 0.034 | 0.199 / 0.084 / 0.036 |
| Humber at Weston | 0.678 / 0.762 / 0.692 | 0.690 / 0.769 / 0.710 |
| East Humber, Rouge | no hourly rain | – |

- **Cross-validation and validation differences are within the fold std everywhere except Highland.**
- **Test is higher with intensity at Black Creek, West Highland and Etobicoke.** That was not used to switch them: picking on test would be tuning on test.

**Feature importance and coefficients:**
- **Highland's final LightGBM:** the new features in its top 15 are `rain_total_day` (0.084 of total gain) and `intensity_ratio` (0.039).
- **Other gauges:** no new feature is in any final model, because all kept LEAN.
- **Logistic-regression coefficients** of the new features on the largest set per gauge are in `results/modelb/logreg_new_feature_coefs.csv`, standardised.
  - **`headroom` has the largest coefficients, negative at 7 of 11 gauges.** Less room below the high-water mark means higher risk, as expected.
  - **`max_1h_rain` and `rain_total_day` are mostly negative.** That's collinearity with LEAN's daily rain (the same Toronto City record at 4 gauges), so the individual signs aren't interpretable.

**Known floods:** unchanged from the LEAN fleet, because the only gauge whose model changed (Highland) doesn't cover 2024.
- **2024-07-16:** Mimico, Black Creek and Humber at Weston were at WARNING the day before.
- **2024-08-17:** missed by every day-before forecast; the storm's rain fell on the day itself.
- **2013-07-08:** train split at every usable gauge, so not evidence.

Table: `results/modelb/known_flood_check.csv`.

## Model B step 6: combiner and leave-one-gauge-out test, re-run

The combiner formula, the R = 15 km cutoff and the null rule are unchanged. Only Highland's model changed, so the leave-one-out result barely moved:

| R | Combiner (LEAN fleet → Model B) | Own model | Mean of all others | Nearest only |
|---|---|---|---|---|
| 10 km (9 gauges) | 0.293 → 0.298 | 0.370 → 0.374 | 0.371 → 0.371 | 0.280 → 0.285 |
| 15 km (9 gauges) | 0.294 → 0.300 | 0.368 → 0.371 | 0.357 → 0.357 | 0.272 → 0.277 |
| 25 km (10 gauges) | 0.325 → 0.330 | 0.409 → 0.413 | 0.366 → 0.366 | 0.311 → 0.315 |

**Conclusions:**
- **The changes (+0.004 to +0.006) are inside the fold std (0.012–0.016).**
- **The earlier conclusions stand:**
  - Neighbours recover part of a gauge's skill (median ratio about 0.9).
  - Inverse-square weighting does not beat a plain average of all gauges.
  - The normalised (p / WATCH) variant is not better beyond noise at R = 15. The raw combiner is kept.
- **Highland pair, own model:** Highland 0.237 (was 0.203). West Highland predicting from Highland: 0.191 (was 0.162).

## Live run (2026-10-17)

`predict_all.py` fetched recent daily and hourly rain from ECCC and scored all 11 gauges. Every gauge is NONE (p = 0.0005–0.047).

- **Imputed rain:** Toronto North York had not yet published daily rain for 10-15 and 10-16. So `rain_today`, `rain_sum_3d` and `rain_sum_7d` were imputed for East Humber, Don West Branch and Rouge, and the output says so.
- **Stale readings:** Mimico, Etobicoke and East Humber were flagged stale; their realtime files were more than 3 h old.
- **Relay example:** `risk_at(43.775, −79.257)` (Scarborough Centre) → combined risk 0.039, NONE. It was driven by the nearest gauge, West Highland (64% of the weight); Cooksville was excluded with its reason.

## Final recommended configuration per gauge

| Gauge | Ship | Feature set | Model | WATCH / WARNING |
|---|---|---|---|---|
| 02HC033 Mimico | yes | LEAN | logreg | 0.048 / 0.348 |
| 02HC030 Etobicoke | yes | LEAN | lgbm | 0.076 / 0.295 |
| 02HC032 East Humber | yes | LEAN | xgb | 0.083 / 0.139 |
| 02HC027 Black Creek | yes | LEAN | xgb | 0.074 / 0.427 |
| 02HC005 Don West Branch | yes | LEAN | logreg | 0.113 / 0.354 |
| 02HC024 Don at Todmorden | yes (weak: test PR-AUC 0.22) | LEAN | xgb | 0.135 / 0.332 |
| 02HC013 Highland | yes (weak: 0.24) | **LEAN+INT** (Toronto City hourly, 20.9 km) | lgbm | 0.072 / 0.284 |
| 02HC058 West Highland | yes (weak: 0.16) | LEAN | xgb | 0.095 / 0.272 |
| 02HC022 Rouge | yes | LEAN | logreg | 0.748 / 0.824 |
| 02HB030 Cooksville | **no** (`usable=false`, excluded from the combiner) | LEAN | logreg | – |
| 02HC003 Humber at Weston | yes | LEAN | xgb | 0.137 / 0.174 |

## Model B limitations

- **Gauge-based proxy label:** creek high water at the gauge (daily mean above the train-period 95th percentile), not street, road or basement flooding.
- **Daily resolution:** a next-24-hours model. Sub-daily peaks are averaged, and a storm that falls on the day itself is invisible to the day-before forecast (2024-08-17).
- **Drainage is estimated, not measured.** The drainage features are proxies. Capacity could be estimated at only 3 of 11 gauges.
- **Rain comes from the nearest climate station, which may be far:**
  - **Daily rain:** up to 20.9 km away.
  - **Hourly rain:** one downtown station (Toronto City) serves all 9 gauges that have it, at up to 20.9 km.
  - **No hourly rain:** East Humber and Rouge.
  - **Live lag:** ECCC daily rain can lag 1–2 days live; missing inputs are imputed and listed.
- **Several gauges end in 2023:** Etobicoke, Don at Todmorden, Highland and West Highland.
- **Cooksville is unusable** (stage–discharge shift, 2014–2021 discharge gap).
- **The combiner is validated only by leave-one-gauge-out**, against gauge labels, not street-level outcomes.
- **Few events per test split** (17–48 events). Most differences in this file are within noise.

---

# Earlier: LEAN-only fleet (before Model B)

These sections describe the LEAN-only fleet that Model B started from. For the 10 gauges that kept LEAN, its models and numbers are identical to Model B's. Its artifacts are in `models/fleet_lean/`, and you can rerun it with `run_all.py --fleet-lean`.

**Where the data files are:**
- **Daily files and `station_screen.csv`** sit in the project root. The code looks in `data/` first, then the root.
- **Realtime files** are in `data/realtime/`. The 8 newer ones were pulled with `python flood_data.py realtime <station>`.
- **Rain pulls** are cached in `data/rain/`.

**Logs:** the LEAN fleet console output is in `results/fleet_run.log`.

## Fleet step 1: rain per gauge (`src/rain_gauges.py`)

**How a rain station is picked for each gauge:**
- **Candidates:** ECCC climate stations from the `climate-stations` collection, sorted by haversine distance from the gauge.
- **Coverage check:** walking outward, each candidate's daily record is pulled (the same `climate-daily` call as `flood_data.py rain`, made with that script's API helpers) and cached.
- **Choice:** the first station with at least 90% `TOTAL_PRECIPITATION` coverage over that gauge's own data period.
- **Pearson** is offered as `6158731`, meaning its two climate IDs combined (6158733 to 2013-06, 6158731 after).

All pulls succeeded. No gauge is more than 25 km from its rain station.

| Gauge | Rain station | Distance | Coverage | Nearer stations skipped (coverage) |
|---|---|---|---|---|
| 02HC033 Mimico | 6158731 Pearson | 9.5 km | 99.7% | Burnhamthorpe 17% |
| 02HC030 Etobicoke | 6158731 Pearson | 10.3 km | 99.7% | Burnhamthorpe 18% |
| 02HC032 East Humber | 615S001 Toronto North York | 18.0 km | 97.1% | 6 stations, 0–51% |
| 02HC027 Black Creek | 6158355 Toronto City | 8.4 km | 96.1% | Burnhamthorpe 17%, Toronto 35% |
| 02HC005 Don West Branch | 615S001 Toronto North York | 6.8 km | 97.3% | Thornhill Grandview 29% |
| 02HC024 Don at Todmorden | 6158355 Toronto City | 3.7 km | 95.9% | East York Dustan 37%, Toronto 37% |
| 02HC013 Highland Creek | 6158355 Toronto City | **20.9 km** | 97.8% | East York 45%, Buttonville 20–53% |
| 02HC058 West Highland Creek | 6158355 Toronto City | 16.4 km | 97.8% | East York 45%, Buttonville 20–53% |
| 02HC022 Rouge | 615S001 Toronto North York | **20.7 km** | 97.2% | Buttonville 16–58%, Frenchmans Bay 12% |
| 02HB030 Cooksville | 6158731 Pearson | 9.5 km | 99.6% | Burnhamthorpe 16% |
| 02HC003 Humber at Weston | 6158731 Pearson | 9.2 km | 99.7% | Burnhamthorpe 17% |

## Fleet step 2: per-gauge models (`src/fleet.py`)

**The recipe is the same as the shipped baseline:**
- **Target:** next-day high water, with the p95 threshold computed on each gauge's train split.
- **Features:** LEAN plus that gauge's rain.
- **Split:** chronological 70/15/15 per gauge, over its own date range. Several gauges end in 2023, and Don West Branch runs to 2025.
- **Models:** the four models, tuned on train with `TimeSeriesSplit(5, gap=3)` scored on PR-AUC.
- **Model choice:** best validation PR-AUC; within 0.01 → F2 → simpler model.

**Alert thresholds, chosen on validation and fixed for test:**
- **WATCH:** the F2-optimal cut-off.
- **WARNING:** the lowest cut-off reaching at least 50% precision on validation (F0.5-optimal if none reaches it), never below WATCH.

**Quality gate:** a gauge needs at least 10 positive days in both validation and test. Gauges that fail are flagged `usable: false` in `models/thresholds.json` and left out of the combiner.

**Outputs:** `models/{station}.joblib`, `models/thresholds.json`, `results/fleet_results.csv`.

### Results on TEST (cut-offs fixed on validation)

| Gauge | Model | Rain | Test high days | PR-AUC (CV ± std) | WATCH P / R / F2 | WATCH events | WARNING P / R | WARNING events | Persistence P / R / F2 | Persistence events | High days with ice/estimated symbol (test; all) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 02HC033 Mimico | logreg | Pearson 9.5 km | 59 | 0.367 (0.358 ± 0.046) | 0.20 / 0.73 / 0.47 | 39/45 | 0.49 / 0.29 | 16/45 | 0.14 / 0.14 / 0.14 | 13/45 | 6/59; 42/379 |
| 02HC030 Etobicoke | lgbm | Pearson 10.3 km | 41 | 0.346 (0.464 ± 0.061) | 0.23 / 0.66 / 0.48 | 24/32 | 0.36 / 0.34 | 14/32 | 0.15 / 0.15 / 0.15 | 8/32 | 2/41; 30/372 |
| 02HC032 East Humber | xgb | North York 18.0 km | 45 | 0.772 (0.803 ± 0.111) | 0.49 / 0.80 / 0.71 | 15/17 | 0.55 / 0.78 | 14/17 | 0.56 / 0.56 / 0.56 | 10/17 | 6/45; 77/324 |
| 02HC027 Black Creek | xgb | Toronto City 8.4 km | 65 | 0.414 (0.400 ± 0.061) | 0.25 / 0.74 / 0.53 | 38/48 | 0.57 / 0.31 | 19/48 | 0.22 / 0.22 / 0.22 | 15/48 | 4/65; 22/411 |
| 02HC005 Don West Branch | logreg | North York 6.8 km | 73 | 0.601 (0.476 ± 0.085) | 0.49 / 0.77 / 0.69 | 30/33 | 0.57 / 0.51 | 20/33 | 0.45 / 0.44 / 0.44 | 21/33 | 5/73; 9/339 |
| 02HC024 Don at Todmorden | xgb | Toronto City 3.7 km | 37 | 0.216 (0.354 ± 0.063) | 0.21 / 0.49 / 0.39 | 16/32 | 0.33 / 0.19 | 7/32 | 0.14 / 0.14 / 0.14 | 3/32 | 4/37; 12/362 |
| 02HC013 Highland Creek | xgb | Toronto City 20.9 km | 34 | 0.203 (0.263 ± 0.028) | 0.13 / 0.68 / 0.37 | 23/31 | 0.35 / 0.26 | 9/31 | 0.06 / 0.06 / 0.06 | 3/31 | 1/34; 33/295 |
| 02HC058 West Highland | xgb | Toronto City 16.4 km | 34 | 0.162 (0.219 ± 0.060) | 0.16 / 0.47 / 0.34 | 15/28 | 0.17 / 0.12 | 4/28 | 0.15 / 0.15 / 0.15 | 5/28 | 4/34; 47/289 |
| 02HC022 Rouge | logreg | North York 20.7 km | 60 | 0.635 (0.689 ± 0.054) | 0.51 / 0.78 / 0.71 | 31/37 | 0.55 / 0.70 | 29/37 | 0.39 / 0.38 / 0.38 | 16/37 | 7/60; 83/394 |
| 02HC003 Humber at Weston | xgb | Pearson 9.2 km | 63 | 0.710 (0.690 ± 0.132) | 0.49 / 0.78 / 0.69 | 26/32 | 0.53 / 0.76 | 25/32 | 0.47 / 0.46 / 0.46 | 17/32 | 3/63; 134/403 |
| **02HB030 Cooksville** | logreg | Pearson 9.5 km | **2** | 0.036 (0.199 ± 0.039) | 0 / 0 / 0 | 0/2 | 0 / 0 | 0/2 | 0 / 0 / 0 | 0/2 | 2/2; 15/128 |

**How the 10 usable gauges compare with persistence:**
- **Every one beats persistence on test F2 at WATCH.** The margins are wide at the urban and Scarborough creeks (e.g. Highland 0.37 vs 0.06) and modest at the slower rivers (Humber at Weston 0.69 vs 0.46, Don West Branch 0.69 vs 0.44).
- **Best:** East Humber, Humber at Weston, Rouge and Don West Branch, with test PR-AUC 0.60–0.77.
- **Weakest:** Highland, West Highland and Don at Todmorden, with test PR-AUC 0.16–0.22. The first two take rain from a station 16–21 km away.
- **Noise:** test splits hold 17–48 events, so differences of a few hundredths are noise.

**WARNING trades recall for precision.** For example, Black Creek goes from 0.25 precision / 0.74 recall at WATCH to 0.57 / 0.31 at WARNING.

**Cooksville (02HB030) is excluded because of a data and model-quality problem, not a code bug.**

`python -m src.diagnose 02HB030` prints the evidence:

- **The rule that excludes it:** `src/fleet.py` marks a gauge `usable=false` unless it has at least 10 high-water days in **both** validation and test. Cooksville has **3** in validation and **2** in test. `src/combine.py` and `src/loo.py` skip `usable=false` gauges. The exact reason is stored as `usable_reason` in `models/thresholds.json` and shown in the combiner's `excluded_unusable_gauges`.
- **Not missing live data:** its realtime file is present and reads normally.
- **Not a bug:** I rebuilt the dataset with the same code. The counts follow directly from the raw file:
  - **Discharge is missing for all of 2014–2021.** The recipe needs discharge, so 2,826 days drop out. That includes 2016–17, which had 96 days above the threshold. As a result, validation stretches from 2013-06 to 2023-06 but holds only 562 rows.
  - **The stage–discharge relation shifted.** At the same low flow (0.08–0.12 m³/s), the median level was 2.137 m in 2005–09, about 2.02–2.04 m in 2010–13, and 1.955 m in 2022–24: **−0.18 m**. That looks like a datum or channel change, but the data cannot confirm the cause. The 2.339 m threshold learned from 2005–2013 was exceeded on 0–2 days per year in 2020–24.
  - **Result:** the model has almost nothing to learn or be checked on. Validation PR-AUC is 0.084 on 3 positive days, and no cut-off reached 50% precision.
- **To use this gauge**, it would need a label that survives the shift (a discharge-based or recent-years threshold) and a way to handle the 2014–2021 discharge gap. Until then it is kept out of the combiner.

**Quality symbols:** 3–13% of test high-water days carry "Ice Conditions" or "Estimated". Over all splits it is 3–33%; Humber at Weston is highest at 134 of 403. Those winter highs may be ice backwater, not runoff.

## Fleet step 3: the combiner (`src/combine.py`)

**The formula:**
- **Weight** for gauge i: `w_i = 1 / max(d_i, 1 km)^2` (haversine distance). Gauges farther than R (default 15 km) are ignored.
- **`weighted_avg`** = Σ w_i p_i / Σ w_i.
- **`near`** = the probability of the nearest gauge within R.
- **`combined_risk`** = `max(near, weighted_avg)`.
- **No gauge within R** → `combined_risk: null`, "no gauge nearby". Nothing is extrapolated.

**The output JSON** also includes:
- **`alert`:** NONE / WATCH / WARNING, using the nearest gauge's thresholds.
- **`gauges_used`:** the gauges used, with distance, weight and reading time.
- **`stale`:** true if any used reading is more than 3 hours old.
- **Exclusions:** unusable or unavailable gauges.

**Example: relay at Scarborough Centre (43.775, −79.257), R = 15 km, readings from `predict_all.py` on 2026-10-17 with rain not supplied:**

| Gauge | Distance | Weight share | p (high tomorrow) |
|---|---|---|---|
| 02HC058 West Highland | 3.07 km | 64% | 0.028 |
| 02HC013 Highland | 5.31 km | 21% | 0.039 |
| 02HC022 Rouge | 9.41 km | 7% | 0.019 |
| 02HC005 Don West Branch | 12.35 km | 4% | 0.009 |
| 02HC024 Don at Todmorden | 13.0 km | 4% | 0.028 |

- **Result:** weighted average 0.0288 and near 0.0278, so combined risk is **0.0288**. Alert is **NONE**, against West Highland's WATCH 0.095 / WARNING 0.272.
- **Freshness:** stale is false; the oldest reading is 0.9 h old.
- **Cooksville** is listed in `excluded_unusable_gauges`.

**Beyond R:** a relay at 44.30, −79.257 returns `combined_risk: null` and "no gauge nearby".

**A design property worth knowing:** because of the `max`, a relay at a gauge's exact location returns that gauge's risk only when that gauge's p is at least the weighted average. A riskier neighbour can raise it. The tests cover both cases.

**Which gauges drove the result:** the output also has `driven_by` (whether `near` or `weighted_avg` set the risk) and, per gauge, `share_of_weighted_avg` (w·p / Σ w·p).

### What-if simulation (`--simulate STATION=PCT`)

`predict_all.py --simulate ...` and `src.combine --simulate ...` work like this:
- **What changes:** the named gauge's latest complete day gets LEVEL and DISCHARGE set to that percentile of the gauge's **training-period** data, and its features and probability are recomputed. Everything else stays real.
- **Nothing real is written:** the change is made on in-memory copies. The realtime CSVs, `data/clean/*.csv` and `results/latest_readings.json` are never written; checksums before and after a simulation matched.
- **Where `predict_all.py` writes:** `results/simulated_readings.json`, and only that.

**Scarborough Centre (43.775, −79.257), R = 15 km, `--simulate 02HC058=99 02HC013=98`, rain imputed:**

| Gauge | Simulated input (real latest day) | p (high tomorrow) | At the gauge | Distance | Weight share | Share of weighted avg |
|---|---|---|---|---|---|---|
| 02HC058 West Highland | level 2.881 m, Q 6.54 m³/s at train p99 (real 2.495 m) | 0.0647 | NONE (WATCH 0.095) | 3.07 km | 64% | 74% |
| 02HC013 Highland | level 6.464 m, Q 9.62 m³/s at train p98 (real 6.095 m) | 0.0561 | NONE (WATCH 0.059) | 5.31 km | 21% | 21% |
| 02HC022 Rouge | real | 0.0185 | NONE | 9.41 km | 7% | 2% |
| 02HC005 Don West Branch | real | 0.0090 | NONE | 12.35 km | 4% | 1% |
| 02HC024 Don at Todmorden | real | 0.0279 | NONE | 13.0 km | 4% | 2% |

- **Result:** combined risk **0.0647**, alert **NONE**. It was driven by `near`: West Highland's p = 0.065 was above the weighted average of 0.056.
- **Why both simulated gauges stay NONE:** the simulation puts each gauge *above* its own high-water line today (2.881 > 2.692 m and 6.464 > 6.347 m), yet both stay below their WATCH cut-offs. At these flashy creeks, a high level today usually recedes by tomorrow; persistence precision there is only 0.06–0.15. The models learned that, so with no rain they don't call a next-day high from a one-day spike.
- **What the simulation does not do:** it moves one day's level and discharge only. Rain stays imputed as dry, and the earlier days stay real.

## Fleet step 4: leave-one-gauge-out test (`src/loo.py`)

**The setup:**
- **Which dates:** for each gauge G, its test dates where G and all neighbours within R have **out-of-train** predictions, meaning the neighbour's row is in its own validation or test split.
- **What is predicted:** G's real labels, by:
  - **(a)** the combiner with G removed, with distances measured from G
  - **(b)** G's own model
  - **(c)** the unweighted mean of all other gauges
  - **(c2)** the unweighted mean of the same neighbours as (a), to isolate the effect of weighting
  - **(d)** the nearest neighbour alone
- **Only usable gauges:** the 10 usable gauges are tested. Cooksville is excluded, as described above.
- **Thresholds, chosen on validation only:**
  - **For each method:** the F2-optimal cut-off on G's **validation** dates, under the same out-of-train rule.
  - **Own model:** G's WATCH, which is itself F2-optimal on G's validation.
  - **When validation is too thin:** if G's validation window has fewer than 5 high-water days with all neighbours out of their train split, the deployment rule is used instead (the nearest neighbour's WATCH for the raw combiner and baselines; 1.0 for the normalised combiner). These are flagged "deploy (val too small)" in the log. This applied to 3 of 9 gauges at R = 15.
- **Noise:** each gauge's test window is split into 5 chronological folds, and the fold std of the gauges-averaged PR-AUC difference is reported.

Full tables are in `results/fleet/loo_results.csv` (per-fold: `loo_folds.csv`); all three radii are in `results/fleet_run.log`.

**R = 15 km, all 10 usable gauges, test PR-AUC on G's real labels:**

| Gauge | Nearest neighbour | Neighbours | Test days | High days | Raw combiner | Normalised combiner | Own | Mean all | Mean within R | Nearest |
|---|---|---|---|---|---|---|---|---|---|---|
| 02HC033 Mimico | 02HC027, 3.3 km | 5 | 798 | 33 | 0.258 | 0.269 | 0.264 | 0.217 | 0.197 | **0.273** |
| 02HC030 Etobicoke | 02HC033, 5.8 km | 3 | 1186 | 41 | 0.309 | 0.295 | 0.346 | **0.358** | 0.314 | 0.287 |
| 02HC032 East Humber | none within 15 km (nearest 23.9 km) | – | – | – | – | – | – | – | – | – |
| 02HC027 Black Creek | 02HC003, 3.1 km | 5 | 865 | 38 | 0.187 | 0.298 | **0.351** | 0.304 | 0.274 | 0.147 |
| 02HC005 Don West Branch | 02HC024, 6.8 km | 5 | 254 | 20 | 0.509 | 0.494 | **0.553** | 0.488 | 0.502 | 0.489 |
| 02HC024 Don at Todmorden | 02HC005, 6.8 km | 5 | 1128 | 37 | 0.204 | 0.234 | 0.217 | **0.290** | 0.269 | 0.182 |
| 02HC013 Highland | 02HC058, 4.4 km | 2 | 964 | 34 | 0.241 | 0.188 | 0.203 | 0.197 | **0.259** | 0.182 |
| 02HC058 West Highland | 02HC013, 4.4 km | 4 | 910 | 34 | 0.197 | 0.166 | 0.167 | 0.185 | **0.206** | 0.164 |
| 02HC022 Rouge | 02HC013, 9.5 km | 2 | 860 | 35 | 0.360 | 0.364 | 0.521 | **0.590** | 0.354 | 0.364 |
| 02HC003 Humber at Weston | 02HC027, 3.1 km | 5 | 847 | 39 | 0.379 | 0.377 | **0.687** | 0.583 | 0.450 | 0.362 |
| **mean of 9** | | | | | 0.294 | 0.298 | 0.368 | 0.357 | 0.314 | 0.272 |

**At the cut-offs chosen on validation (means over the 9 gauges):**

| Method | Precision | Recall |
|---|---|---|
| Raw combiner | 0.23 | 0.63 |
| Normalised combiner | 0.21 | 0.62 |
| Own model | 0.28 | 0.67 |

Per-gauge precision / recall / events are in the log.

East Humber is evaluated only at R = 25 km. Its nearest usable neighbour is Humber at Weston, 23.9 km away. There, the raw combiner scores 0.590, the normalised one 0.538, and its own model 0.772.

**Summary across radii** (mean PR-AUC over gauges):

| R | Gauges | Raw combiner | Normalised | Own | Mean all | Mean within R | Nearest | Raw / own (median) | Raw beats own / mean all / mean within R / nearest |
|---|---|---|---|---|---|---|---|---|---|
| 10 km | 9 | 0.293 | 0.302 | 0.370 | 0.371 | 0.305 | 0.280 | 0.87 | 1 / 3 / 1 / 4 of 9 |
| 15 km | 9 | 0.294 | 0.298 | 0.368 | 0.357 | 0.314 | 0.272 | 0.92 | 2 / 4 / 3 / 7 of 9 |
| 25 km | 10 | 0.325 | 0.323 | 0.409 | 0.366 | 0.344 | 0.311 | 0.89 | 2 / 5 / 5 / 8 of 10 |

**What this says, plainly:**
- **How close (a) gets to (b):** between gauges, the combiner reaches a median of 0.87–0.92 of a gauge's own PR-AUC (range 0.53–1.19).
  - **Where it falls short:** at the bigger rivers with their own strong models. Humber at Weston drops from 0.69 to 0.38, Rouge from 0.52 to 0.36, Black Creek from 0.35 to 0.19.
  - **Where it ties or beats:** at the weak Scarborough gauges, where the own model is poor too.
- **Weighting does not reliably beat simple averaging.**
  - **Same gauges, unweighted:** the inverse-square combiner beats the plain mean of the same neighbours at only 1–5 gauges, depending on R.
  - **All gauges, unweighted:** the plain mean of all other gauges has the higher average PR-AUC at every R (0.357–0.371 vs 0.293–0.325).
  - **Nearest-only:** the combiner beats the nearest neighbour alone at 4/9, 7/9 and 8/10 gauges. That is the one comparison it mostly wins.
- **The combiner is a high-recall, low-precision alarm.** At R = 15, with cut-offs chosen on validation, it caught 46–100% of each gauge's events (13/28 at Mimico, 19/19 at Humber at Weston), with precision 0.13–0.47.
- **Treat the pattern as the finding, not any single number.** The test windows hold 20–41 high days per gauge, so most per-gauge differences are within noise. The pattern is: weighting ≈ averaging, and both are below the gauge's own model.

### Raw vs normalised combiner (score = p / WATCH of each gauge)

The normalised version applies the same formula to each neighbour's `p / WATCH`, so every gauge is on its own alert scale (1.0 = at WATCH).

| R | Raw PR-AUC | Normalised PR-AUC | Difference | Per-fold differences | Fold std | Beyond noise? | Recall raw / norm | Precision raw / norm |
|---|---|---|---|---|---|---|---|---|
| 10 km | 0.293 | 0.302 | +0.009 | +0.004, +0.014, +0.001, +0.013, +0.017 | 0.007 | marginally yes | 0.60 / 0.58 | 0.22 / 0.24 |
| 15 km | 0.294 | 0.298 | +0.005 | −0.005, +0.011, −0.011, +0.019, +0.006 | 0.012 | no | 0.63 / 0.62 | 0.23 / 0.21 |
| 25 km | 0.325 | 0.323 | −0.002 | +0.000, +0.004, −0.020, +0.017, +0.003 | 0.013 | no | 0.72 / 0.69 | 0.21 / 0.21 |

**Decision: keep the current raw-probability combiner.**
- **At the default R = 15 km** the normalised version gains only +0.005 PR-AUC, less than half the fold std, and it has slightly lower recall and precision.
- **At R = 25 km** it is slightly worse.
- **Only at R = 10 km** does it clear the fold std, by +0.009 PR-AUC. That std comes from just 5 folds, and recall drops at the same time.
- **Per gauge it cuts both ways:** it helps Black Creek a lot (0.187 → 0.298) and hurts Highland (0.241 → 0.188) and West Highland (0.197 → 0.166).

**Highland pair (4.4 km apart), test:**

| Gauge | Method | PR-AUC | Precision | Recall | Events |
|---|---|---|---|---|---|
| 02HC013 Highland | own model | 0.203 | 0.14 | 0.68 | 23/31 |
| 02HC013 Highland | West Highland's model only | 0.182 | 0.16 | 0.47 | 17/31 |
| 02HC058 West Highland | own model | 0.165 | 0.16 | 0.47 | 15/28 |
| 02HC058 West Highland | Highland's model only | 0.162 | 0.13 | 0.65 | 20/28 |

The partner gauge comes close to the own model on PR-AUC for both. That's mostly because both own models are weak, and both use the same rain station 16–21 km away. At R = 15 km the combiner does slightly better than either own model there (0.241 vs 0.203, and 0.197 vs 0.167). At R = 10 km it does for Highland only (0.241 vs 0.203; West Highland 0.162 vs 0.165).

**Scope:** this measures whether *other gauges* can stand in for a gauge's creek high water. It is not a validation of flooding at any street or relay location.

## Fleet step 5: known-flood check

Full table: `results/fleet/known_flood_check.csv`. Each cell is the alert level the day before → on the day.
- **"Day before"** is the forecast issued on D−1 for day D: the useful warning.
- **"On the day"** is the forecast issued on D for D+1.

**2024-07-16 (test split at every gauge that covers it):**

| Gauge | High that day? | Day before → on the day |
|---|---|---|
| Mimico | yes | **WARNING** (p=0.77) → WARNING |
| Black Creek | yes | **WARNING** (0.53) → WARNING |
| Humber at Weston | yes | **WARNING** (0.70) → WARNING |
| Don West Branch | yes | NONE (0.08) → WARNING |
| Rouge | yes | NONE (0.27, below its 0.748 WATCH) → WARNING |
| East Humber | no | NONE → WARNING |
| Cooksville (unusable) | yes | NONE (0.11) → WARNING |

**2024-08-17 (test split):**
- **Missed by every covering gauge's day-before forecast.** All were NONE, with p ≤ 0.02: Mimico, Black Creek, Don West Branch and Humber were high and missed.
- **Same-day forecasts went to WARNING at most gauges.**
- **Why:** this storm's rain fell on the day itself, so a forecast issued the day before, using only observed rain, could not see it.

**2013-07-08:** in the train split at every gauge except Cooksville, so it is **not evidence**. Cooksville's row is in its validation split, and its day-before forecast was WARNING.

**Not covered:** Etobicoke, Don at Todmorden, Highland and West Highland have no data for the 2024 dates; their records end on 2023-12-31.

## predict_all.py

`predict_all.py` reads the latest realtime CSV for each gauge:
- **Features:** it builds LEAN features from the last complete local day (daily means, ~29 days of history).
- **Output:** P(high tomorrow), NONE / WATCH / WARNING, and the latest reading time with a stale flag.
- **Rain:** (LEAN fleet era) rain was imputed unless supplied. Model B's `predict_all.py` now fetches recent daily and hourly rain from ECCC instead (`--offline` uses the cache). The old `--rain-json` option is gone.
- **File:** it writes `results/latest_readings.json`, which `src.combine` reads.

On 2026-10-17 (rain imputed) every gauge was NONE (p = 0.0005–0.039). Mimico, Etobicoke and East Humber were **stale**: their realtime files were downloaded ~4 h earlier.

## Fleet limitations

- **Each gauge model covers its own catchment.** It says nothing about other creeks or streets.
- **The combiner only estimates between gauges.** It is validated only by leaving out one gauge at a time, not against street-level flood labels. In that test it did not beat simple averaging.
- **The label is a gauge-based proxy:** the daily mean level above the gauge's own train-period 95th percentile. It is not street or property flooding.
- **Daily data only:** next-24-hours forecasts, with sub-daily flash peaks averaged out. Day-of storms, as on 2024-08-17, are invisible to the day-before forecast.
- **Rain comes from the nearest long-record climate station**, up to 20.9 km away (Highland, Rouge) and often downtown or Pearson, not inside the catchment. It is observed rain, not forecast rain.
- **Several gauges end in 2023:** Etobicoke, Don at Todmorden, Highland and West Highland. Their test periods are 2020/21–2023 and say nothing about 2024 storms.
- **Cooksville (02HB030) is unusable as configured:** discharge is missing for 2014–2021, and the stage–discharge relation shifted by −0.18 m. It has 3 validation and 2 test events. See `python -m src.diagnose 02HB030`.
- **The what-if simulation moves only the latest day's level and discharge.** It is a sensitivity check, not a storm scenario: rain stays imputed, and earlier days stay real.
- **Few events per test split** (17–48), and winter ice/estimated readings are inside the labels.

---

# Earlier 3-station study (v1, v2, multiclass)

The sections below are the earlier study on Mimico, Etobicoke and East Humber. It's how the shipped recipe was chosen: LEAN features with rain, next-day target, p95, binary model. Run it with `run_all.py --v2`, `--v1` or `--multiclass`. Its models live in `models/v2/`, `models/best_*.joblib` and `models/multiclass/`. `predict.py` serves those 3-station models.

| Station | Name in the file (checked at runtime) | Character |
|---|---|---|
| 02HC033 | MIMICO CREEK AT ISLINGTON | urban, flashy |
| 02HC030 | ETOBICOKE CREEK BELOW QUEEN ELIZABETH HIGHWAY | urban, flashy |
| 02HC032 | EAST HUMBER RIVER AT KING CREEK | rural, slower |

- **v2:** adds Pearson rain, three feature sets, two targets (next-day forecast and same-day nowcast), and two thresholds (p95, p97).
- **Multiclass (experimental):** a NORMAL / ELEVATED / HIGH next-day variant. **Not recommended for shipping**; see its section below.
- **v1 (raw-features baseline):** today's LEVEL and DISCHARGE only. Its results are kept at the end of this file.

The full v2 console output is in `results/run_all_v2.log`.

## Rain data

The rain comes from Toronto Pearson. ECCC splits Pearson into two climate IDs:

| Climate ID | Station name | Covers |
|---|---|---|
| `6158733` | TORONTO LESTER B. PEARSON INT'L A | 2000-01-01 → 2013-06-12 |
| `6158731` | TORONTO INTL A | 2013-06-13 → 2024-12-31 |

- **How it was downloaded:** with `flood_data.py rain <id>`. The raw files are in `data/rain_download/`.
- **How it was combined:** `python -m src.fetch_rain` joins the two into `data/6158731_rain_daily.csv`. Where both report a day, `6158731` wins. They overlap on only one day.
- **Coverage:** 99.7% of station days have `TOTAL_PRECIPITATION`.
- **Gap filling:** 26 days in gaps of 2 days or less were filled with 0. No longer gaps exist, so no rain values are left NaN. A `rain_missing` flag is kept in the cleaned data but is not used as a model input.
- **`SNOW_ON_GROUND` was skipped.** It has 74–83% coverage in train but only 23–24% in validation+test, because the newer station rarely reports it. The rule was at least 80% in both.

## What v2 does

### Split and tuning

- **Split:** the same chronological 70/15/15 split as v1, using the same boundary dates for both targets.
- **Thresholds:** the train-period p95 and p97 of LEVEL. LEVEL is a gauge height above a datum, not a depth.
- **Tuning:** RandomizedSearchCV with `TimeSeriesSplit(5, gap=3)`, scored on PR-AUC (`average_precision`), random_state=42. It runs on train rows only; validation and test are never passed to a tuning call.
- **Decision cut-off:** the one that maximises F2 on validation. Test is scored once with that fixed cut-off.

### Feature sets (`src/features.py`)

Every feature at row t uses only data from days up to t. Tests in `tests/test_features.py` scramble everything after t and confirm that no feature at t or earlier changes. I also confirmed the test fails when a leak is injected on purpose.

**NEXT-DAY target** (`y = LEVEL[t+1] > threshold`, forecast issued at the end of day t):

| Set | Features |
|---|---|
| LEVEL_ONLY (3) | level, level_chg_1d, level_chg_3d |
| LEAN (14) | level, disch, level_chg_1d, level_chg_3d, disch_chg_1d, level_accel, level_max_3d, level_max_7d, level_z30, rain_today, rain_sum_3d, rain_sum_7d, month_sin, month_cos |
| BIG (36) | LEAN + level/disch lags 1, 2, 3, 7 + level/disch rolling mean and std over 7, 14, 30 days + disch_level_ratio + days_since_high (capped at 365) |

`level_z30` compares today's level with the mean and std of the 30 days *before* today.

**SAME-DAY target** (`y = LEVEL[t] > threshold`, a nowcast). It may not use today's LEVEL or anything derived from it. It also excludes today's DISCHARGE, because discharge is computed from the gauge level.

| Set | Features |
|---|---|
| LEVEL_ONLY (3) | level_y1, level_chg_1d_y1, level_chg_3d_y1 |
| LEAN (9) | level_y1, level_chg_1d_y1, disch_y1, disch_chg_1d_y1, rain_today, rain_sum_3d, rain_sum_7d, month_sin, month_cos |
| BIG (36) | LEAN + every other hydro feature, as of yesterday |

`_y1` means "as of yesterday".

A test checks that same-day inputs do not change when today's LEVEL and DISCHARGE are altered, and that none of their names is a today-derived feature.

### Experiments

For each station × target × percentile:

1. **Pick the feature set:** LightGBM, fast-tuned (n_iter=10), compares LEVEL_ONLY / LEAN / BIG / LEAN_NO_RAIN by CV PR-AUC on train. LEAN is kept unless BIG beats it by more than one std.
2. **Tune all four models** on the chosen set: LogisticRegression, RandomForest, LightGBM, XGBoost (n_iter=40).
3. **Baselines:**
   - persistence: next-day "high tomorrow if high today"; same-day "high today if high yesterday"
   - always "no flood"
4. **Pick the winner** on validation PR-AUC. Ties within 0.01 go to F2, then to the simpler model.

**Events:** consecutive high days merged across gaps of 2 days or less. An event is caught if an alarm targets any day inside it. For next-day, "fired day before" means the forecast issued the day before onset said "high tomorrow".

None of the 12 setups had fewer than 10 positive days in validation or test.

## v2 results

### 1. Feature sets: LEAN won everywhere

These are LightGBM CV PR-AUC scores on train (mean ± std).

| Station | Target | Pct | LEVEL_ONLY | LEAN | BIG | LEAN_NO_RAIN |
|---|---|---|---|---|---|---|
| Mimico | next | 95 | 0.129 ± 0.016 | **0.340 ± 0.082** | 0.316 ± 0.065 | 0.198 ± 0.025 |
| Mimico | next | 97 | 0.083 ± 0.018 | **0.284 ± 0.068** | 0.255 ± 0.074 | 0.132 ± 0.046 |
| Mimico | same | 95 | 0.129 ± 0.015 | **0.683 ± 0.062** | 0.678 ± 0.057 | 0.183 ± 0.052 |
| Mimico | same | 97 | 0.087 ± 0.024 | **0.521 ± 0.077** | 0.549 ± 0.101 | 0.121 ± 0.042 |
| Etobicoke | next | 95 | 0.227 ± 0.039 | **0.435 ± 0.042** | 0.417 ± 0.078 | 0.321 ± 0.067 |
| Etobicoke | next | 97 | 0.158 ± 0.039 | **0.348 ± 0.040** | 0.367 ± 0.063 | 0.231 ± 0.033 |
| Etobicoke | same | 95 | 0.215 ± 0.052 | **0.667 ± 0.066** | 0.645 ± 0.101 | 0.334 ± 0.069 |
| Etobicoke | same | 97 | 0.163 ± 0.049 | **0.563 ± 0.113** | 0.575 ± 0.105 | 0.257 ± 0.043 |
| East Humber | next | 95 | 0.689 ± 0.118 | **0.760 ± 0.107** | 0.755 ± 0.114 | 0.700 ± 0.130 |
| East Humber | next | 97 | 0.615 ± 0.137 | **0.710 ± 0.119** | 0.706 ± 0.137 | 0.659 ± 0.145 |
| East Humber | same | 95 | 0.686 ± 0.115 | **0.744 ± 0.114** | 0.750 ± 0.115 | 0.708 ± 0.145 |
| East Humber | same | 97 | 0.618 ± 0.142 | **0.709 ± 0.154** | 0.685 ± 0.167 | 0.672 ± 0.164 |

- **LEAN vs LEVEL_ONLY:** LEAN wins clearly at Mimico and Etobicoke, roughly 2–6× the CV PR-AUC. At East Humber LEAN is also ahead (+0.06 to +0.09), but that is within one std.
- **LEAN vs BIG:** BIG never beat LEAN by more than one std. It was slightly ahead in 4 of 12 setups (+0.006 to +0.028), so LEAN was kept everywhere.

### 2. Rain helped a lot at the urban creeks, and little at East Humber

These are LightGBM scores, LEAN vs LEAN_NO_RAIN.

| Station | Target | Pct | CV PR-AUC | Test PR-AUC | Test events caught |
|---|---|---|---|---|---|
| Mimico | next | 95 | 0.340 vs 0.198 | 0.397 vs 0.183 | 32/45 vs 22/45 |
| Mimico | same | 95 | 0.683 vs 0.183 | 0.535 vs 0.177 | 39/45 vs 19/45 |
| Etobicoke | next | 95 | 0.435 vs 0.321 | 0.320 vs 0.247 | 23/32 vs 17/32 |
| Etobicoke | same | 95 | 0.667 vs 0.334 | 0.598 vs 0.272 | 29/32 vs 18/32 |
| East Humber | next | 95 | 0.760 vs 0.700 | 0.713 vs 0.625 | 15/17 vs 11/17 |
| East Humber | same | 95 | 0.744 vs 0.708 | 0.656 vs 0.640 | 14/17 vs 14/17 |

- **p97 rows** are in `results/model_comparison_v2.csv`. They show the same pattern in CV, but test event counts are mixed. For example, Etobicoke next-day p97 caught 9/25 events with rain vs 12/25 without.
- **Feature importance:** `rain_today` or `rain_sum_3d` is the top feature at both urban creeks, for both targets. At East Humber, `level` and `disch` dominate (0.35–0.42 gain share for level).

### 3. Chosen model per setup vs persistence (TEST, cut-off fixed on validation)

| Station | Target | Pct | Model | Precision | Recall | F2 | PR-AUC (CV ± std) | Events caught | Fired day before | Persistence F2 | Persistence events |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Mimico | next | 95 | logreg | 0.197 | 0.729 | **0.474** | 0.367 (0.358 ± 0.046) | **39/45** | 31/45 | 0.136 | 13/45 |
| Mimico | next | 97 | lgbm | 0.407 | 0.289 | 0.307 | 0.284 (0.320 ± 0.104) | 9/30 | 6/30 | 0.158 | 8/30 |
| Mimico | same | 95 | logreg | 0.522 | 0.610 | 0.590 | 0.545 (0.653 ± 0.069) | 26/45 | – | 0.136 | 13/45 |
| Mimico | same | 97 | xgb | 0.472 | 0.447 | 0.452 | 0.516 (0.541 ± 0.094) | 17/30 | – | 0.158 | 8/30 |
| Etobicoke | next | 95 | lgbm | 0.231 | 0.659 | **0.480** | 0.346 (0.464 ± 0.061) | **24/32** | 19/32 | 0.146 | 8/32 |
| Etobicoke | next | 97 | xgb | 0.381 | 0.276 | 0.292 | 0.297 (0.387 ± 0.075) | 8/25 | 4/25 | 0.138 | 4/25 |
| Etobicoke | same | 95 | xgb | 0.336 | 0.951 | 0.696 | 0.616 (0.670 ± 0.071) | 31/32 | – | 0.146 | 8/32 |
| Etobicoke | same | 97 | xgb | 0.457 | 0.724 | 0.648 | 0.598 (0.600 ± 0.088) | 17/25 | – | 0.138 | 4/25 |
| East Humber | next | 95 | logreg | 0.604 | 0.711 | **0.687** | 0.670 (0.780 ± 0.102) | **15/17** | 9/17 | 0.556 | 10/17 |
| East Humber | next | 97 | logreg | 0.383 | 0.720 | 0.612 | 0.474 (0.732 ± 0.128) | 12/14 | 8/14 | 0.440 | 8/14 |
| East Humber | same | 95 | logreg | 0.442 | 0.756 | 0.661 | 0.557 (0.746 ± 0.106) | 13/17 | – | 0.556 | 10/17 |
| East Humber | same | 97 | logreg | 0.306 | 0.760 | 0.586 | 0.394 (0.701 ± 0.146) | 10/14 | – | 0.440 | 8/14 |

- **Every chosen model beats persistence on test F2, in all 12 setups.**
- **Noise:** test holds only 14–45 events per setup, and CV std runs from 0.05 to 0.15. Differences of a few hundredths between models are within noise.
- **Accuracy is in the CSV but not used for ranking.** Always "no flood" scores 95–98% while catching nothing.

### 4. Known-flood check (p97 winners)

Full table: `results/v2/known_flood_check.csv`. Rows in the **train split do not count as evidence**, because the model saw them during fitting. Only the evidence rows are listed here.

| Station | Date | Split | Level (m) | Next-day flag | Same-day flag |
|---|---|---|---|---|---|
| Mimico | 2024-07-16 | test | 6.419 (above the 5.888 threshold) | **YES** (p=0.37) | **YES** (p=0.71) |
| Mimico | 2024-08-17 | test | 6.221 | no (p=0.00) | **YES** (p=0.77) |
| Mimico | 2022-02-17 | test | 6.723 (record peak) | no (p=0.04) | **YES** (p=0.87) |
| Mimico | 2024-01-24 | test | 6.442 | no (p=0.09) | no (p=0.06) |
| Mimico | 2020-01-12 | val | – | YES | YES |
| Etobicoke | 2020-01-12 | val | – | YES | YES |
| Etobicoke | 2022-02-17 | test | – | no | **YES** |
| East Humber | 2020-01-12, 2019-03-15, 2019-02-05 | val | – | YES | YES |

Notes on the other dates:

- **Etobicoke has no data for 2024-07-16 or 2024-08-17.** Its record ends on 2023-12-31.
- **East Humber, 2024-07-16 and 2024-08-17:** its level stayed *below* its 1.736 m threshold (1.506 and 1.362 m). The same-day model still flagged both at p=1.00, so these were rain-driven **false alarms** for that creek.
- **No usable row:** Mimico 2014-01-11 and East Humber 2013-07-08 (missing readings around those days).
- **The 2013-07-08 storm** falls in train for Mimico and Etobicoke, so it is not evidence.

## Recommendation: what to ship per station

**Use NEXT-DAY, p95, LEAN features at every station.** The models are saved in `models/v2/best_{station}_next_p95.joblib`.

| Station | Model | Test results | Persistence on test |
|---|---|---|---|
| Mimico | logistic regression | F2 0.474; recall 0.73, precision 0.20; 39/45 events caught, 31/45 flagged the day before onset | F2 0.136, 13/45 events |
| Etobicoke | LightGBM | F2 0.480; recall 0.66, precision 0.23; 24/32 events, 19/32 the day before | F2 0.146, 8/32 |
| East Humber | logistic regression | F2 0.687; recall 0.71, precision 0.60; 15/17 events, 9/17 the day before | F2 0.556, 10/17 |

**Why p95 rather than p97:**
- **The two aren't directly comparable:** PR-AUC and F2 change with how rare the label is, so p95 vs p97 scores can't be compared head to head.
- **p97 next-day collapses at the urban creeks:** it catches only 9/30 events at Mimico and 8/25 at Etobicoke.
- **p95 has more training positives,** so its numbers are less noisy.
- **The cost:** p95 marks "high water" at a lower bar.

**Why next-day rather than same-day:**
- **Same-day scores higher at the urban creeks:** test PR-AUC is 0.55–0.62, against 0.35–0.37 for next-day.
- **But it is not a warning.** Its label is today's *daily mean* level, and it uses today's *full-day* rain total. Both are only known at the end of the day, when the gauge itself already shows the answer.
- **Where same-day is useful:** as a fallback when the gauge is down, or as a proxy for ungauged creeks nearby.
- **East Humber:** next-day is better on both F2 and events.

**What these numbers mean in practice:**
- **Mimico and Etobicoke:** roughly 4 of 5 alarms are false. The model catches most events, but it isn't precise.
- **Deployment needs live rain:** the model needs Pearson's daily rain total for day t at inference time.
- **`predict.py` serves this recommended model by default** (binary, next-day, p95). See the predict.py section below.

## Multiclass variant: NORMAL / ELEVATED / HIGH (next-day)

### Setup

- **Classes:** based on tomorrow's daily mean LEVEL, using train-period percentiles.
  - **NORMAL:** at or below p90.
  - **ELEVATED:** above p90, up to p95.
  - **HIGH:** above p95.
- **Same as v2:** chronological split, LEAN features (14), and all four models.
- **Class weighting:** every model uses `class_weight="balanced"`. XGBoost has no `class_weight`, so it computes balanced sample weights inside each fit. Nothing is oversampled.
- **Logistic regression:** lbfgs, which fits a multinomial model for 3 classes. sklearn 1.9 no longer has a `multi_class` argument.
- **Tuning:** TimeSeriesSplit on train only, scored on `f1_macro` (n_iter=40).
- **Run:** `python run_all.py --multiclass` (`src/multiclass.py`). The final run is logged in `results/multiclass_run.log`.

**Class counts per split.** No class fell under 15 in train or 8 in validation/test, so there were no small-class warnings.

| Station | Train N / E / H | Val N / E / H | Test N / E / H |
|---|---|---|---|
| Mimico | 5005 / 278 / 269 | 1085 / 54 / 51 | 1072 / 59 / 59 |
| Etobicoke | 4984 / 275 / 277 | 1068 / 64 / 54 | 1101 / 44 / 41 |
| East Humber | 4564 / 245 / 249 | 1008 / 45 / 30 | 999 / 40 / 45 |

### Candidates and decision rules

**Two kinds of candidate per model family:**
- **Direct:** one 3-class model.
- **Ordinal:** two binary models of the same family, P(L > p90) and P(L > p95), each tuned on PR-AUC. They combine as:
  - P(HIGH) = min(P>p95, P>p90)
  - P(ELEVATED) = P>p90 - P(HIGH)
  - P(NORMAL) = 1 - P>p90

**Two decision rules:**
- **argmax:** the class with the highest probability.
- **safety:** HIGH if P(HIGH) >= t2; otherwise ELEVATED if P(ELEVATED)+P(HIGH) >= t1; otherwise NORMAL.
  - t2 is the F2-optimal cut-off for "HIGH" on validation; t1 is the same for "ELEVATED or higher".
  - Test is scored once with both fixed.

The best candidate per station was picked on validation macro-F1 (argmax rule). Ties within 0.01 go to the simpler model.

### Results on TEST

"Two-class misses" means true HIGH predicted NORMAL / true NORMAL predicted HIGH.

| Station | Best (val) | Rule | Macro-F1 (CV ± std) | Weighted-F1 | κ quadratic | ELEVATED P / R | HIGH P / R | Two-class misses |
|---|---|---|---|---|---|---|---|---|
| Mimico | direct-lgbm | argmax | 0.523 (0.497 ± 0.032) | 0.883 | 0.494 | 0.23 / 0.22 | 0.35 / 0.46 | 23 / 30 |
| Mimico | direct-lgbm | safety | 0.480 | 0.851 | 0.453 | 0.11 / 0.20 | 0.30 / 0.54 | 14 / 51 |
| Mimico | persistence | - | 0.405 (0.419 ± 0.023) | 0.849 | 0.218 | 0.15 / 0.15 | 0.14 / 0.14 | 42 / 38 |
| Etobicoke | direct-xgb | argmax | 0.538 (0.546 ± 0.031) | 0.901 | 0.467 | 0.22 / 0.43 | 0.30 / 0.51 | 10 / 37 |
| Etobicoke | direct-xgb | safety | 0.519 | 0.885 | 0.442 | 0.17 / 0.48 | 0.30 / 0.51 | 8 / 38 |
| Etobicoke | persistence | - | 0.435 (0.461 ± 0.027) | 0.899 | 0.306 | 0.21 / 0.21 | 0.15 / 0.15 | 28 / 22 |
| East Humber | ordinal-lgbm | argmax | 0.725 (0.702 ± 0.057) | 0.952 | 0.785 | 0.47 / 0.60 | 0.75 / 0.60 | 8 / 2 |
| East Humber | ordinal-lgbm | safety | 0.575 | 0.924 | 0.631 | 0.39 / 0.18 | 0.37 / 0.84 | 5 / 39 |
| East Humber | persistence | - | 0.551 (0.640 ± 0.050) | 0.921 | 0.674 | 0.13 / 0.13 | 0.56 / 0.56 | 14 / 2 |

Always-NORMAL scores a macro-F1 of 0.32 and κ of 0 at every station. Full rows for every candidate and both splits are in `results/multiclass_comparison.csv`. The confusion matrices are in `results/multiclass/{station}_confusion_3class.png`.

**Notes on the results:**
- **Direct vs ordinal:** direct won on validation for every model family at Mimico and Etobicoke.
  - The ordinal argmax almost never predicts ELEVATED (ELEVATED recall 0-0.11). P(ELEVATED) is the difference of two probabilities, so it's rarely the largest.
  - At East Humber ordinal-lgbm was best (val 0.687 vs 0.640 for direct-lgbm), but that gap is within the CV std (~0.05).
- **The safety rule raises HIGH recall but lowers macro-F1.** At East Humber its t2 came out tiny (0.000048), so it fires HIGH on almost any non-zero P(HIGH) and test HIGH precision falls from 0.75 to 0.37.
- **Feature importance** (best direct tree model): `rain_today` is first at Mimico (0.15) and Etobicoke (0.14). `level` is first at East Humber (0.33). Files: `results/multiclass/importance_*.csv`.

### Collapse check: does multiclass lose anything on the original task? (TEST)

**HIGH alone vs LEVEL > p95**, compared with the shipped v2 binary p95 model (same rows, same features, same threshold):

| Station | Multiclass HIGH (argmax): P / R / events | Multiclass HIGH (safety): P / R / events | Binary v2 p95: P / R / events |
|---|---|---|---|
| Mimico | 0.35 / 0.46 / 25 of 45 | 0.30 / 0.54 / 28 of 45 | 0.20 / **0.73 / 39 of 45** |
| Etobicoke | 0.30 / 0.51 / 20 of 32 | 0.30 / 0.51 / 19 of 32 | 0.23 / **0.66 / 24 of 32** |
| East Humber | 0.75 / 0.60 / 12 of 17 | 0.37 / 0.84 / 15 of 17 | 0.60 / 0.71 / **15 of 17** |

**ELEVATED+HIGH merged into "alert" vs LEVEL > p90**, compared with a binary P(L > p90) model with an F2 cut-off from validation:

| Station | Alert (argmax): P / R / events | Alert (safety): P / R / events | Binary p90: P / R / events |
|---|---|---|---|
| Mimico | 0.52 / 0.59 / 54 of 69 | 0.38 / 0.70 / 59 of 69 | 0.33 / **0.75 / 61 of 69** |
| Etobicoke | 0.40 / 0.73 / 37 of 44 | 0.34 / 0.77 / 37 of 44 | 0.29 / **0.81 / 39 of 44** |
| East Humber | 0.78 / 0.80 / 25 of 26 | 0.60 / 0.86 / 25 of 26 | 0.78 / 0.82 / 25 of 26 |

**Multiclass catches fewer events than the binary models at the two urban creeks, at both thresholds** (p95: 25-28 vs 39 of 45, and 19-20 vs 24 of 32). It gets better precision in exchange. Missing a flood is worse than a false alarm, so that's a loss on the original task.

### Verdict: keep the binary models

- **ELEVATED is too confused to be useful at Mimico and Etobicoke.** Its test precision is 0.11-0.23. True-ELEVATED days are predicted NORMAL or HIGH about as often as ELEVATED: Mimico 26 / 13 / 20, Etobicoke 13 / 19 / 12.
- **Multiclass loses HIGH events** at the urban creeks (25 vs 39 of 45, and 20 vs 24 of 32).
- **East Humber is the only station where it holds up:** macro-F1 0.725, κ 0.785, ELEVATED P/R 0.47/0.60. Even there, the binary p95 model catches more HIGH events (15 vs 12 of 17) and ties on p90 events.
- **A two-tier binary setup is better:** a p90 model for "watch" plus the shipped p95 model for "alert" catches more events at both tiers on every station. The 3-class probabilities can still be shown as an informational display at East Humber.

## predict.py

`predict.py` serves the **binary v2 next-day p95 model** (`models/v2/best_{station}_next_p95.joblib`) by default:
- **History:** it builds the LEAN features from the last complete local day in the realtime file, using daily **mean** level and discharge (what the models were trained on) and the ~29 days of realtime history.
- **Output:** it prints P(LEVEL tomorrow > train p95) and a YES/NO flag at the cut-off chosen on validation (max F2).
- **Rain:** the realtime file has no rain, so pass Pearson totals with `--rain-today/--rain-3d/--rain-7d`. Missing rain is filled with the train median, which effectively means a dry day, and the script prints a warning when that happens.
- **`--multiclass`:** prints the experimental NORMAL / ELEVATED / HIGH output. Its model files (`models/multiclass/`) are **not** on the `ShyZen15/ML-Models` branch; rebuild them with `python run_all.py --multiclass`.
- **`--v1`:** keeps the old raw-feature binary output.

Demo for 2026-10-16 with no rain supplied:

| Station | Model | P(high tomorrow) | Cut-off | Flag |
|---|---|---|---|---|
| Mimico | logreg | 0.016 | 0.048 | NO |
| Etobicoke | lgbm | 0.011 | 0.076 | NO |
| East Humber | logreg | 0.0004 | 0.228 | NO |

With `--rain-today 45 --rain-3d 60 --rain-7d 70`, Mimico goes to P = 0.98 -> YES.

## Limitations

- **Daily data only.** These are next-24-hours or same-day models. Flash peaks shorter than a day get averaged into the daily mean.
- **The label is a gauge-based proxy.** It means "the creek's daily mean level is above its own train-period p95/p97". It is **not** street or property flooding, and it says nothing about specific roads.
- **Few events in test:** 14–45 per setup. Every number above has wide error bars.
- **Winter ice and snowmelt.** Many top-3% days carry "Ice Conditions": 25 of 247 at Mimico, 13 of 241 at Etobicoke, 50 of 224 at East Humber. Some winter "high water" is ice backwater or melt. `SNOW_ON_GROUND` could not be used because coverage after 2013 is too low.
- **A single rain station.** Pearson sits at the edge of these watersheds, so local storms can be missed or over-weighted. The East Humber false alarms in July/August 2024 may be partly this.
- **Observed rain, not forecast rain.** A real next-day warning would also want a rain forecast.
- **Not tested on recent data.** Daily records end in 2023 (Etobicoke) or 2024. The 2026 realtime data was not used for any v2 check.
- **Multiclass ELEVATED band is narrow.** p90 to p95 is only 0.09-0.12 m of gauge height, and daily-mean noise blurs it. That's part of why ELEVATED is confused at the urban creeks.

## Files

```
run_all.py                         entry point (v2 by default, --v1 for the baseline)
src/clean.py                       step 1, incl. rain merge and short-gap rain fill
src/fetch_rain.py                  combines the two Pearson climate records
src/features.py, src/label.py      v2 features (3 sets x 2 targets) and labels/split/persistence
src/experiments.py                 v2 experiments, events, importances, known-flood check, plots
src/summarise_v2.py                condensed answers from the v2 CSV
tests/test_features.py             leakage + same-day input tests
results/model_comparison_v2.csv    every v2 row (val + test, CV mean/std, confusion matrix, events)
results/v2/table_{station}.csv     per-station table as printed
results/v2/{station}_pr_curves.png, {station}_confusion_matrices.png
results/v2/importance_*.csv        top-15 importances, best tree model per station/target/pct
results/v2/known_flood_check.csv
results/v2/best_params_v2.json     tuned params ({} = default kept) + chosen feature set
models/v2/best_{station}_{target}_p{pct}.joblib
src/gauges.py                      station_screen.csv loader + haversine distances (fleet)
src/rain_gauges.py                 per-gauge climate station choice + cached pulls in data/rain/ (fleet)
src/fleet.py                       per-gauge models, WATCH/WARNING thresholds, usable gate, known floods (fleet)
src/combine.py                     distance-weighted combiner + CLI (fleet)
src/loo.py                         leave-one-gauge-out test (fleet)
src/live.py, predict_all.py        LEAN features from realtime files; per-gauge latest table (fleet)
tests/test_combine.py              combiner tests
models/{station}.joblib, models/thresholds.json      fleet models and alert thresholds
results/fleet_results.csv, results/fleet/            fleet tables, LOO results, known-flood check, predictions
src/multiclass.py                  NORMAL/ELEVATED/HIGH variant (direct + ordinal, argmax + safety rule, collapse check)
results/multiclass_comparison.csv  every multiclass row (val + test, per-class P/R, kappa, two-class misses, CV macro-F1)
results/multiclass_collapse_check.csv  multiclass vs binary at p90/p95 (precision, recall, events)
results/multiclass/                3x3 confusion matrices, importances
models/multiclass/best_{station}.joblib  3-class model(s) (not committed; rebuilt by run_all.py --multiclass)
src/compare_high.py                binary p95 vs 3-class on the HIGH class -> results/high_class_comparison.csv
predict.py                         binary v2 next-day p95 inference (--multiclass, --v1 for the others)
```

---

## v1 baseline (raw features: LEVEL, DISCHARGE only; no rain)

These are test results with the p97 label and cut-offs fixed on validation. Logistic regression won at every station.

| Station | Precision | Recall | F2 | PR-AUC | Events caught | Persistence F2 | Persistence events |
|---|---|---|---|---|---|---|---|
| Mimico | 0.108 | 0.333 | 0.236 | 0.144 | 12/31 | 0.154 | 8/31 |
| Etobicoke | 0.111 | 0.379 | 0.256 | 0.168 | 10/25 | 0.138 | 4/25 |
| East Humber | 0.293 | 0.654 | 0.525 | 0.390 | 9/13 | 0.423 | 7/13 |

At the same p97 next-day setting, v2 improves test F2 to 0.307, 0.292 and 0.612. The event counts differ slightly from v1, because v2 keeps the full calendar and computes the threshold over all train-period days.

**About the v1 files:**
- **`results/model_comparison.csv` and `models/best_*.joblib`** come from the v1 no-rain run. `predict.py --v1` uses them.
- **Re-running `--v1` now adds rain:** the rain file exists, so v1 picks up `TOTAL_PRECIPITATION` as a third raw feature. That changes these numbers.
- **The `--v1` path still works:** I ran it after the v2 changes, with its outputs sent to a scratch folder, and it finished with exit 0.

**`predict.py --v1` caveat:** the daily files hold the daily *mean* level, but `--v1` feeds the daily *max* level from the realtime file, as v1's spec asked. This biases its probabilities upward.
