# FloodSense

FloodSense gives MedMesh a **creek high-water risk** score for three Water Survey of Canada stations:

| Station | Name in the file (checked at runtime) | Character |
|---|---|---|
| 02HC033 | MIMICO CREEK AT ISLINGTON | urban, flashy |
| 02HC030 | ETOBICOKE CREEK BELOW QUEEN ELIZABETH HIGHWAY | urban, flashy |
| 02HC032 | EAST HUMBER RIVER AT KING CREEK | rural, slower |

There are two versions:

- **v2 (current, the default):** adds Pearson rain, three feature sets, two targets (next-day forecast and same-day nowcast), and two thresholds (p95, p97).
- **Multiclass (experimental):** a NORMAL / ELEVATED / HIGH next-day variant. **Not recommended for shipping**; see its section below.
- **v1 (raw-features baseline):** today's LEVEL and DISCHARGE only. Its results are kept at the end of this file.

## How to run

```bash
python -m venv .venv                     # Python 3.11
.venv/Scripts/python -m pip install pandas numpy scikit-learn lightgbm xgboost matplotlib joblib scipy pytest requests
.venv/Scripts/python run_all.py          # v2, n_iter=40 for the four models: 478 s on this machine
.venv/Scripts/python run_all.py --fast   # v2, n_iter=10: 268 s
.venv/Scripts/python run_all.py --v1     # v1 raw-features baseline
.venv/Scripts/python run_all.py --multiclass   # NORMAL / ELEVATED / HIGH variant: 342 s on this machine
.venv/Scripts/python predict.py --station 02HC033 --rain-today 12 --rain-3d 20 --rain-7d 25
.venv/Scripts/python -m pytest tests -q  # leakage tests (14 pass)
.venv/Scripts/python -m src.summarise_v2 # condensed v2 answers from results/model_comparison_v2.csv
```

Tested with Python 3.11.0, pandas 3.0.6, numpy 2.4.6, scikit-learn 1.9.1, lightgbm 4.7.0 and xgboost 3.2.0. The full v2 console output is in `results/run_all_v2.log`.

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
