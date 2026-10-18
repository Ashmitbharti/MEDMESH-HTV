# Model A: mesh link health (MedMesh)

**What it predicts:** for each Meshtastic node, the probability **A** that its link **fails within the next 120 s**. "Fails" means a silence of 90 s or more. The horizon is `common.HORIZON`; it was 180 s until it was shortened to make higher accuracy reachable (see "Why 120 s").

**What it outputs:** `predict_link.link_risk(node_id)` returns A, an alert level (NONE / WATCH / WARNING) and the features pushing A up.

## How to run

```bash
cd "Node-Health ML"
python -m venv .venv                                  # Python 3.11
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python run_all.py --fast                # 110-row coverage set: data, leakage tests, train/evaluate, demo (51 s here)
.venv/Scripts/python run_all.py                       # the same plus the big simulated set (295 s here)
.venv/Scripts/python run_all.py --big                 # big set only
```

**Individual steps:**

```bash
.venv/Scripts/python make_coverage_data.py            # data/coverage.csv (+ data/raw/synth_cov_*.csv packet logs)
.venv/Scripts/python make_coverage_data.py --big      # data/big.csv (+ data/raw/synth_big_*.csv)
.venv/Scripts/python build_dataset.py "data/raw/synth_cov_*.csv" --out data/rebuilt.csv   # rows from raw logs
.venv/Scripts/python train.py                         # coverage set -> results/coverage/, models/
.venv/Scripts/python train.py --data big              # big set      -> results/big/, models/big/
.venv/Scripts/python train.py --n-iter-logreg 100     # wider logistic-regression search (default 60)
.venv/Scripts/python -m pytest tests -q               # 17 tests: leakage + labels
.venv/Scripts/python predict_link.py '!a1b2c302'      # newest log in data/raw/, scored at its last packet
.venv/Scripts/python predict_link.py --all --log results/replay/demo_replay_log.csv
.venv/Scripts/python demo_replay.py                   # 3-minute SIMULATED REPLAY in real time
.venv/Scripts/python demo_replay.py --speed 20        # 20x faster
.venv/Scripts/python demo_replay.py --model models/big/linkhealth.joblib
```

**In the command centre:**

```python
from predict_link import link_risk
link_risk("!a1b2c302")                          # newest data/raw/*.csv, "now" = its last packet
link_risk("!a1b2c302", log_path="data/raw/walkout_01.csv", now="wall")   # live: score at the current clock time
```

The result has:
- **Score and alert:** `A`, `alert` and `status` (`OK`, `SILENT` or `NO_DATA`).
- **Why:** `top_features`. Each entry is a feature, its value, its typical (train median) value, and how much A drops if that feature is set back to typical.
- **Context:** `snr_mean_30s`, `rssi_mean_30s`, `seconds_since_last_packet`, `thresholds`, `model`, and `dataset`.

**Silence override:** a node already silent for 90 s or more is no longer a prediction. It gets `status=SILENT, alert=WARNING` whatever A says.

## Files

| File | What |
|---|---|
| `common.py` | Constants (incl. `HORIZON = 120`), log reading, **the one feature function** (`node_features_at`, past packets only), and labels |
| `make_coverage_data.py` | Writes simulated raw logs, builds rows from them, samples the coverage set, and prints the coverage table |
| `build_dataset.py` | Raw `collect_min.py` logs → one row per 10 s window per node (also for real logs) |
| `train.py` | Split, tuning, thresholds, evaluation, per-scenario results, overfitting checks, save |
| `predict_link.py` | `link_risk(node_id)` from the tail of a log |
| `collect_min.py` | The real Meshtastic logger (unchanged) |
| `tests/test_features.py` | Leakage tests and label tests |

**Outputs:**
- **Models:** `models/linkhealth.joblib`, `models/thresholds.json` and `models/features.json` are trained on the coverage set. The same three files from the big set are in `models/big/`. `thresholds.json` holds WATCH, WARNING and ACCURACY.
- **Results:** `results/coverage/` and `results/big/` hold the tables and plots. `tuning_results_logreg.csv` lists all 60 logistic-regression candidates.
- **Logs:** `results/run_all*.log` holds the full printed runs.
- **Demo:** `results/demo_replay.csv` (coverage model) and `results/demo_replay_big_model.csv`.

## Data

**Rows and labels:**
- **One row** per 10 s window of one node, from 30 s after the node is first heard.
- **Features** use only packets with timestamp ≤ t.
- **Label `label_fail_within_120s`:** 1 if a silence of 90 s or more starts within 120 s after t. The silence's start is the node's last packet before it.

**Rows that are dropped:**
- **Already silent:** rows at or after a silence start, until the node is heard again. These are detection, not prediction; the live override handles them.
- **Censored:** rows where the log ends too soon to rule out a failure (t + 120 + 90 s past the end).

**Columns:**
- **Identity:** scenario, session_id, node_id, t_seconds.
- **Model features:** snr_mean/slope/std_30s, rssi_mean/slope_30s, packets_per_min, hops_used, hops_change_120s, seconds_since_last_packet, battery_voltage, voltage_slope (V/min) and channel_utilization.
- **Missing flags:** snr, snr_slope, hops, voltage and chutil.
- **Label and markers:** the label and is_simulated.
- **Not features:** `snr_max_30s` is used only by the SNR baseline rule. `time_to_failure_s` is used for lead times. `in_event` is used for sampling.

**Assumptions** (not measurements):
- **Traffic:** each node sends every 3–7 s. About 25% of packets are telemetry, carrying voltage and channel use.
- **Reception:** a packet arrives with probability sigmoid((SNR − (−15 dB)) / 1.2), times a loss factor that some scenarios lower.
- **RSSI:** noise floor + SNR + noise.

**Sessions differ by:**
- **Link:** base SNR (0–10 dB), channel use (2–25%) and hop count (0 or 1).
- **Power:** battery level.
- **Timing:** random event timing.

### Coverage set (`make_coverage_data.py`)

11 scenarios × 10 short sessions each. Every session yields **one sampled row**:
- **Failure sessions:** alternate one positive, one negative.
- **Hard-negative sessions:** 80% of their rows come from inside the dip, burst or walk-away.

```
                    rows  sessions  positives           kind
walkout               10        10          5        failure
obstruction           10        10          5        failure
stepwise_fade         10        10          5        failure
water                 10        10          5        failure
hard_unplug           10        10          5        failure
relay_failure         10        10          5        failure
brownout              10        10          5        failure
short_dip             10        10          0  hard negative
interference_burst    10        10          0  hard negative
walk_away_back        10        10          0  hard negative
baseline              10        10          0       baseline
TOTAL                110       110         35       (31.8% positive)
```

**Raw logs:** the logs behind these rows are in `data/raw/synth_cov_*.csv` (collect_min format). Each has a `_events.csv` file and a `_manifest.json` that says which node and time range belongs to which scenario. All windows of these sessions are in `data/coverage_all_windows.csv`. **Check run:** rebuilding them from the raw logs with `build_dataset.py` gave an identical table.

**`--big` set:** 20 sessions of 25–30 min each:
- **Nodes:** 3 scenario nodes, each running a chain of scenario episodes. A failed node comes back after its silence.
- **Helpers:** a stable anchor node, plus a relay for each node that has a relay failure.
- **Size:** 6,666 rows, 1,608 positives (24.1%), **134 failure events**.

## Why 120 s: the accuracy ceiling

**The limit:** some positive rows come *before anything has changed in the signal*. For example, a hard unplug, or the first minutes before a walk-out starts. No model can tell those apart from healthy rows. If a perfect model got every other row right, its accuracy would be 1 − (those rows ÷ all rows).

**Measured on the big set's simulator ground truth:**

| horizon | test positives | best possible test accuracy | always "no" accuracy |
|---|---|---|---|
| 180 s (before) | 41.0% | **77.4%** | 59.0% |
| **120 s (now)** | 26.5% | **88.4%** | 73.5% |
| 90 s | 20.5% | 92.2% | 79.5% |
| 60 s | 13.7% | 95.7% | 86.3% |

**What it means:**
- **180 s couldn't reach 85% accuracy,** even with a perfect model.
- **120 s makes 85% possible** (ceiling 88.4%).
- **Below about 70 s, accuracy stops meaning anything:** always answering "no" already scores 85% or more.
- **The trade-off:** a shorter horizon gives less warning time.

## Process (same as FloodSense)

1. **Split by session, never by row:** 60/20/20. In the coverage set it is also stratified by scenario: each scenario puts 6 sessions in train, 2 in validation and 2 in test, with positives 3/1/1. `train.py` prints every session in each split and the positives per split (`results/*/split_sessions.csv`).
2. **Tuning on TRAIN only:**
   - **Search:** GroupKFold(5) by session, RandomizedSearchCV, scored on average_precision.
   - **Rule:** a tuned set is kept only if it beats the defaults by 0.01 or more in CV PR-AUC.
   - **Logistic regression gets a wider search:** 60 candidates (`--n-iter-logreg`).
     - **C:** log-uniform between 1e-4 and 100.
     - **Penalty mix (`l1_ratio`):** 0, 0.25, 0.5, 0.75 or 1, from pure L2 to pure L1, with the saga solver.
     - **class_weight:** None or balanced.
   - **RF and LightGBM:** keep n_iter=15.
3. **Models:**
   - **LogisticRegression:** default C=0.1, L2, balanced classes.
   - **RandomForest:** 200 trees, max_depth 3, min_samples_leaf 3.
   - **LightGBM:** 100 trees, num_leaves 4, max_depth 2, min_child_samples 10 (coverage) or 50 (big).
   - **Baselines:**
     - **SNR rule:** max SNR over 30 s < X.
     - **Silence rule:** seconds_since_last_packet ≥ Y.
     - **Always-no.**
4. **Thresholds on VALIDATION:**
   - **WATCH:** the F2-optimal threshold.
   - **WARNING:** the lowest threshold at or above WATCH that reaches 50% precision. If none does, the F0.5-optimal one.
   - **ACCURACY (new):** the threshold that maximises validation accuracy. It is reported as its own operating point. The live alert levels still use WATCH and WARNING.
5. **TEST scored once** with those thresholds fixed.
6. **Winner:** highest validation PR-AUC. Within 0.01, higher F2. Within 0.01 again, the simpler model.
7. **Per-scenario recall and false-alarm rate**, plus leave-one-session-out and leave-one-scenario-out CV over all rows. These CVs are diagnostic only: they use the fixed params and thresholds, and nothing is chosen from them.
8. **Overfitting checks:**
   - **Train vs CV gap.**
   - **Shuffled labels:** CV with permuted labels, compared with random scores on the same folds.
   - **Learning curve:** 25/50/75/100% of train sessions, scored on validation.
   - **Leave-one-scenario-out.**
9. **Leakage test** (`tests/test_features.py`):
   - **Feature check:** features at t must not change when every later packet is altered, a third of them are dropped, and new ones are added.
   - **Paths covered:** checked on 5 scenarios × 3 cut points, and once through the full raw-log → dataset path.
   - **Label check:** a test confirms the 120 s horizon. A row 140 s before a failure is 0; a row 110 s before it is 1.
   - **The test can fail:** I planted a 10 s look-ahead in the feature code, and 11 of the 17 tests failed. Without it, all pass.

## Results: big simulated set (`results/big/`)

**Size:** 4,086 / 1,266 / 1,314 rows in train / val / test (12/4/4 sessions). Test has 348 positives (26.5%) and 29 failure events.

**Logistic-regression tuning:**
- **Default:** C=0.1, L2, balanced. CV PR-AUC 0.705 ± 0.036.
- **Best of the 60 candidates:** C=0.032, L2, no class weight. CV PR-AUC 0.710 ± 0.036.
- **Gain:** +0.006, below the 0.01 rule, so **the defaults are kept**.
- **The top 5 candidates are all within 0.002 of each other,** so this model is already at its ceiling on these features.
- **Other models:** RF gained +0.021 (tuned params kept). LightGBM gained +0.006 (defaults kept).

**Winner: RandomForest.** Validation PR-AUC was 0.633, against lgbm 0.622 and logreg 0.614, which is within noise.

**TEST, scored once with thresholds fixed on validation:**

| model | level | accuracy | precision | recall | F1 | F2 | MSE (Brier) | TN / FP / FN / TP | events caught | median lead |
|---|---|---|---|---|---|---|---|---|---|---|
| **rf (shipped)** | **ACCURACY** | **0.833** | 0.957 | 0.385 | 0.549 | 0.437 | 0.154 | 960 / 6 / 214 / 134 | 20/29 | 77 s |
| rf | WARNING | 0.791 | 0.628 | 0.523 | 0.571 | 0.541 | 0.154 | 858 / 108 / 166 / 182 | 21/29 | 96 s |
| rf | WATCH | 0.460 | 0.308 | 0.833 | 0.450 | 0.621 | 0.154 | 314 / 652 / 58 / 290 | 27/29 | 114 s |
| lgbm | ACCURACY | 0.828 | 0.962 | 0.365 | 0.529 | 0.417 | 0.137 | 961 / 5 / 221 / 127 | 20/29 | 77 s |
| **logreg** | **ACCURACY** | **0.823** | 0.887 | 0.382 | 0.534 | 0.431 | 0.160 | 949 / 17 / 215 / 133 | 20/29 | 70 s |
| logreg | WARNING | 0.813 | 0.712 | 0.491 | 0.582 | 0.524 | 0.160 | 897 / 69 / 177 / 171 | 21/29 | 91 s |
| logreg | WATCH | 0.432 | 0.306 | 0.908 | 0.458 | 0.652 | 0.160 | 251 / 715 / 32 / 316 | 29/29 | 116 s |
| snr_rule | ACCURACY | 0.769 | 1.000 | 0.129 | 0.229 | 0.157 | – | 966 / 0 / 303 / 45 | 8/29 | 53 s |
| always_no | – | 0.735 | 0 | 0 | 0 | 0 | 0.265 | 966 / 0 / 348 / 0 | 0/29 | – |

PR-AUC on test: rf 0.667, lgbm 0.662, logreg 0.653, snr_rule 0.484, silence_rule 0.378, base rate 0.265. ROC-AUC: rf 0.740, logreg 0.733.

**Accuracy results:**
- **Validation:** 0.848 (rf), 0.848 (logreg), 0.852 (lgbm).
- **Test:** 0.833 (rf), 0.823 (logreg), 0.828 (lgbm), scored once.
- **85% was reached on validation, not on test.** Test is 1.7 points short.
- **Ceiling and floor:** the test ceiling is 0.884 and always "no" scores 0.735.
- **How the accuracy point works:** it alarms rarely (6 false alarms in 966 negatives) and catches about 38% of positive rows. That is still 20 of 29 failure events, with a 77 s median lead.

**Where it fails** (rf, leave-one-session-out, WARNING):
- **Missed failures:**

  | scenario | recall at WARNING |
  |---|---|
  | **hard_unplug** | 0.00 |
  | **obstruction** | 0.04 |
  | walkout | 0.44 |
  | relay_failure | 0.59 |
  | stepwise_fade | 1.00 |
  | water | 0.94 |
  | brownout | 0.94 |

- **Hard unplug is as expected:** nothing in the signal precedes it.
- **Obstruction:** the drop takes 6–20 s, so most of the 120 s lead-up looks normal.
- **False alarms at WARNING:**

  | scenario | false-alarm rate at WARNING |
  |---|---|
  | short_dip | 10% |
  | interference_burst | 12% |
  | walk_away_back | 20% |
  | stepwise_fade negatives | 25% |
  | stable baseline | 5% |

- **Leave-one-scenario-out:** brownout and water negatives alarm at WARNING 70% and 44% of the time when the model never saw those scenarios.

**Overfitting checks:**
- **Train vs CV gap:** logreg −0.003, rf 0.053, lgbm 0.055.
- **Shuffled labels:** CV PR-AUC 0.24 for all three, against 0.248 for random scores. No leakage sign.
- **Learning curve:** validation PR-AUC rises 0.58 → 0.63 from 3 to 12 sessions.

**Most important features:**
- **rf:** rssi_mean_30s, snr_mean_30s, voltage_slope, battery_voltage.
- **logreg coefficients (per std):**
  - voltage_slope −0.70
  - packets_per_min +0.58
  - rssi_mean and snr_mean −0.42
  - seconds_since_last_packet +0.34
  - hops_change_120s +0.33

## Results: 110-row coverage set (`results/coverage/`)

**Logistic-regression tuning picked a degenerate model.**
- **What was picked:** the best of 60 candidates was C=0.00012 with no class weight. CV PR-AUC was 0.672, against 0.635 for the defaults. That gain (+0.037) passed the 0.01 rule, so it was kept.
- **Why it's degenerate:** at that strength every coefficient is about 0.00. A is nearly the same for every row, so WATCH, WARNING and ACCURACY are 0.3183, 0.3189 and 0.3201.
- **Test:** accuracy 0.773 at the ACCURACY level (15/0/5/2), against 0.682 for always "no". PR-AUC 0.639.
- **The test result doesn't hold up:**
  - **Leave-one-session-out:** pooled PR-AUC 0.188 and ROC-AUC 0.028. That is worse than random.
  - **Leave-one-scenario-out:** pooled PR-AUC 0.245.
  - **Shuffled-label check:** BORDERLINE.
- **Bottom line:** the 77% test accuracy comes from tiny score differences on 22 rows, not a working model. **Do not ship the coverage-set logistic regression.** With 66 training rows, tuning fits noise, as the original brief expected.

| model | level | accuracy | precision | recall | F1 | F2 | MSE (Brier) | TN / FP / FN / TP |
|---|---|---|---|---|---|---|---|---|
| logreg (tuned, degenerate) | ACCURACY | 0.773 | 1.000 | 0.286 | 0.444 | 0.333 | 0.217 | 15 / 0 / 5 / 2 |
| logreg | WARNING | 0.636 | 0.455 | 0.714 | 0.556 | 0.641 | 0.217 | 9 / 6 / 2 / 5 |
| rf | WARNING | 0.682 | 0.500 | 0.429 | 0.462 | 0.441 | 0.232 | 12 / 3 / 4 / 3 |
| silence_rule | WARNING | 0.727 | 1.000 | 0.143 | 0.250 | 0.172 | – | 15 / 0 / 6 / 1 |
| always_no | – | 0.682 | 0 | 0 | 0 | 0 | 0.318 | 15 / 0 / 7 / 0 |

**Leave-one-session-out, pooled PR-AUC:** rf 0.524, lgbm 0.526, snr_rule 0.518, silence_rule 0.451, base 0.318. **On 110 rows no model clearly beats the SNR rule.** RF and LightGBM have a train-vs-CV gap of about 0.53: they memorise.

Rows are marked SIMULATED REPLAY.

| model | steady link (0–20 s) | WARNING first fires | verdict |
|---|---|---|---|
| big-set rf (`--model models/big/linkhealth.joblib`) | A ≈ 0.31–0.32, **WATCH already on** (threshold 0.309) | t=50 s, **56 s before the last packet**; A rises to 0.985 | WATCH is a false alarm on the steady link |
| coverage logreg (default) | WATCH on at t=0 | t=80 s, 26 s before the last packet | degenerate model; see above |

**Summary:** with the big-set model, A tracks the fade well. But the F2-optimal WATCH sits just below the steady-link score, so the clean NONE → WATCH → WARNING sequence still doesn't happen.

**After silence:** once the node goes quiet, the big-set model's A drops to about 0.47 (WARNING still holds), because training never sees rows from after a silence starts. The 90 s silence override covers this case live.

## Known limitations and what to do next

1. **Record real data.** Run `collect_min.py` sessions for each scenario and type notes at the events. Then run `build_dataset.py data/raw/<session>.csv`: without a manifest every node gets rows with scenario `real`, and the labels come from silences in the log. Check `*_first_packets.json` against the field names that `common.prepare_log` expects.
2. **Choose WATCH differently.** F2-optimal WATCH alarms on most healthy rows, including the steady demo link. Options: F1-optimal, a fixed precision of about 40%, or a false-alarm budget on validation.
3. **Ship the big-set model, not the coverage one.** Tuning on 66 rows chose a model that does nothing (see above). If the coverage model must ship, a minimum on C (for example ≥ 0.01) would stop that.
4. **Getting past 83% test accuracy** needs better inputs, not more tuning; the logistic-regression search is flat. Candidates: longer-history features (60–120 s SNR trend, packet-loss trend), or a shorter horizon.
5. **Simulated is not real.** The physics in `simulate.py` (reception curve, packet rate, voltage curve) are assumptions.
