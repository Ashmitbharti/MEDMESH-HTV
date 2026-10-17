# Model card: FloodSense Model B

**Purpose.** For each of 11 Water Survey of Canada gauges in the Toronto area, estimate the probability that the gauge's daily mean level will be above its own high-water mark **tomorrow**, and turn it into NONE / WATCH / WARNING. A distance-weighted combiner (`floodrisk.risk_at`) turns gauge probabilities into a risk at a MedMesh relay location. It is a decision aid for routing and relay alerts, not a flood forecast for streets or buildings.

**Label.** y(t) = 1 if LEVEL(t+1) > the 95th percentile of LEVEL over that gauge's TRAIN period. LEVEL is a gauge height above a local datum (not water depth), daily mean, local standard time.

**Data sources.**
- **Water levels and discharge:** ECCC Water Survey of Canada daily files and realtime 5-minute data (GeoMet API).
- **Daily rain:** the nearest ECCC climate station with >= 90% coverage of the gauge's period. Toronto Pearson is two climate IDs combined.
- **Hourly rain:** ECCC `climate-hourly` PRECIP_AMOUNT, nearest station with <= 30% missing hours and <= 25 km away. Only Toronto City (6158355) qualified; Pearson and Buttonville publish no hourly precipitation.

**Method.**
- **Split:** chronological 70/15/15 per gauge.
- **Feature sets compared:** LEAN (level/discharge trends + daily rain + season) against LEAN + rain-intensity, + drainage proxies, + net rain-minus-capacity features.
- **Set choice:** the richer set is kept only if it beats LEAN in cross-validation on train by more than one fold std AND validation PR-AUC does not drop.
- **Models:** LogisticRegression, RandomForest, LightGBM and XGBoost, tuned on TRAIN with TimeSeriesSplit(5, gap=3) scored on average precision. The best is chosen on VALIDATION PR-AUC / F2.
- **Thresholds:** WATCH = F2-optimal on validation. WARNING = the lowest cut-off with >= 50% validation precision, else F0.5-optimal, never below WATCH.
- **Test:** scored once with those fixed cut-offs.

**The drainage features are proxies, not measured drainage.** They are antecedent rain, recession rate, discharge change, headroom below the high-water mark, and a "capacity" read off train-period bins.

## Per gauge

| Gauge | Usable | Feature set | Model | Train period | Daily rain | Hourly rain | Capacity | Test high days | Precision | Recall | F2 | PR-AUC (CV ± std) | Events caught | Flagged day before |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02HC033 Mimico Creek At Islington | yes | LEAN | logreg | 2002-01-01 – 2018-06-25 | 6158731 (9.5 km) | 6158355 (9.9 km) | not estimated | 59 | 0.20 | 0.73 | 0.47 | 0.367 (0.358 ± 0.046) | 39/45 | 31/45 |
| 02HC030 Etobicoke Creek Below Queen  | yes | LEAN | lgbm | 2002-01-01 – 2017-05-26 | 6158731 (10.3 km) | 6158355 (14.5 km) | not estimated | 41 | 0.23 | 0.66 | 0.48 | 0.346 (0.464 ± 0.061) | 24/32 | 19/32 |
| 02HC032 East Humber River At King Cr | yes | LEAN | xgb | 2003-05-23 – 2019-01-24 | 615S001 (18.0 km) | skipped | 30.4 mm (rain_today) | 45 | 0.49 | 0.80 | 0.71 | 0.772 (0.803 ± 0.111) | 15/17 | 11/17 |
| 02HC027 Black Creek Near Weston | yes | LEAN | xgb | 2002-01-01 – 2018-02-10 | 6158355 (8.4 km) | 6158355 (8.4 km) | not estimated | 65 | 0.25 | 0.74 | 0.53 | 0.414 (0.400 ± 0.061) | 38/48 | 34/48 |
| 02HC005 Don River West Branch At Yor | yes | LEAN | logreg | 2005-04-01 – 2019-06-08 | 615S001 (6.8 km) | 6158355 (8.2 km) | 13.0 mm (max_1h_rain) | 73 | 0.49 | 0.77 | 0.69 | 0.601 (0.476 ± 0.085) | 30/33 | 19/33 |
| 02HC024 Don River At Todmorden | yes | LEAN | xgb | 2002-01-01 – 2017-06-04 | 6158355 (3.7 km) | 6158355 (3.7 km) | not estimated | 37 | 0.21 | 0.49 | 0.39 | 0.216 (0.354 ± 0.063) | 16/32 | 13/32 |
| 02HC013 Highland Creek Near West Hil | yes | LEAN+INT | lgbm | 2006-01-01 – 2018-09-10 | 6158355 (20.9 km) | 6158355 (20.9 km) | not estimated | 34 | 0.18 | 0.59 | 0.40 | 0.237 (0.260 ± 0.063) | 20/31 | 18/31 |
| 02HC058 West Highland Creek Near Sca | yes | LEAN | xgb | 2006-04-01 – 2018-10-25 | 6158355 (16.4 km) | 6158355 (16.4 km) | not estimated | 34 | 0.16 | 0.47 | 0.34 | 0.162 (0.219 ± 0.060) | 15/28 | 12/28 |
| 02HC022 Rouge River Near Markham | yes | LEAN | logreg | 2002-01-01 – 2018-01-07 | 615S001 (20.7 km) | skipped | 16.0 mm (rain_today) | 60 | 0.51 | 0.78 | 0.71 | 0.635 (0.689 ± 0.054) | 31/37 | 24/37 |
| 02HB030 Cooksville Creek Near Cooksv | **no** | LEAN | logreg | 2006-04-01 – 2013-06-08 | 6158731 (9.5 km) | 6158355 (19.8 km) | not estimated | 2 | 0.00 | 0.00 | 0.00 | 0.036 (0.199 ± 0.039) | 0/2 | 0/2 |
| 02HC003 Humber River At Weston | yes | LEAN | xgb | 2002-01-01 – 2018-03-13 | 6158731 (9.2 km) | 6158355 (10.3 km) | not estimated | 63 | 0.49 | 0.78 | 0.69 | 0.710 (0.690 ± 0.132) | 26/32 | 18/32 |

Metrics are on each gauge's TEST split at the WATCH cut-off. Test splits hold 17–48 events, so differences of a few hundredths are within noise.

## Combiner

**The formula:**
- **Weights:** `w = 1 / max(d, 1 km)^2` (haversine). Gauges beyond R = 15 km are ignored.
- **Combined risk:** `max(nearest gauge p, weighted mean p)`.
- **No gauge within R:** null ("no gauge nearby").
- **Exclusions:** gauges with `usable = false` are skipped.

**Leave-one-gauge-out test, mean PR-AUC over gauges:**

| R | Combiner from neighbours | Gauge's own model |
|---|---|---|
| 10 km | 0.298 | 0.374 |
| 15 km | 0.300 | 0.371 |
| 25 km | 0.330 | 0.413 |

Neighbours recover part of a gauge's skill, not all of it.

## Known limitations

- **Gauge-based proxy label:** creek high water at a gauge, not street, basement or road flooding.
- **Daily resolution:** a next-24-hours model. Sub-daily flash peaks are averaged, and same-day storms are not visible to the day-before forecast.
- **Drainage is estimated, not measured.** Capacity comes from train-period bins and could not be estimated where no rain bin reached a 30% next-day high-water rate.
- **Rain comes from the nearest climate station, which may be far:**
  - Daily rain is up to 20.9 km away (Highland, Rouge).
  - Hourly rain is from one downtown station (Toronto City), up to 20.9 km away.
  - East Humber and Rouge have no hourly rain.
- **Several gauges end in 2023** (Etobicoke, Don at Todmorden, Highland, West Highland).
- **Cooksville (02HB030) is `usable = false`:** too few validation/test events after a stage–discharge shift and a 2014–2021 discharge gap (`python -m src.diagnose 02HB030`).
- **The combiner is validated only by leave-one-gauge-out**, not against street-level labels.
- **Live inputs can be incomplete:** live rain is fetched from ECCC and can lag a day. Missing inputs are imputed with train medians and listed in `imputed`.
