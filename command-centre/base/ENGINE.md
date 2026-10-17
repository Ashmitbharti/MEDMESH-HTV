# MedMesh dispatch engine

The command centre's decision core (`base/engine/`). It runs fully offline on the command-centre laptop.
**No AI model makes any dispatch decision.** Every choice comes from explicit models and optimisation, and
every decision is stored with all its inputs, alternatives and reasons.

## What happens when an SOS arrives

1. **Duplicate check** (`dedup.py`). Reports within 150 m and 15 minutes with the same complaint are clustered
   (union-find) into one incident, so one patient never gets two ambulances. Two different MedMesh IDs are never merged.
2. **Clinical profile** (`clinical.py`). START triage (rule-based) plus the complaint give the required capability
   (cardiac, trauma, burns, obstetrics) and a time constant τ for how fast outcomes worsen with delay.
   Minor (green) patients may go to clinics; for them the capability is only a preference.
3. **Road times** (`routing.py`). The road network is compiled into a sparse matrix; one Dijkstra run from the
   patient gives travel times to every facility at once. Blocked roads and flood zones are removed; the flood-risk
   forecast adds a soft penalty (1 + 2·p) and closes roads above p = 0.85. Congestion learned from ambulance GPS is included.
4. **Ambulance** (`optimizer.py`). Many-to-one search picks the available unit with the shortest road time to the patient.
5. **ED waiting time** (`queueing.py`). Each emergency department is an M/M/c queue with non-preemptive priority
   (Cobham's formula on top of Erlang C). The model is calibrated to each hospital's reported average wait, then
   live MedMesh dispatches are added as arrivals, so a hospital's predicted wait rises as we send patients there.
   Red patients are seen first, so their wait stays short even when the ED is busy; green patients' waits grow fast.
6. **Beds** (`estimator.py`). A Kalman filter per hospital nowcasts free beds between reports: it subtracts beds we
   assign, drifts with unseen walk-ins and discharges, grows its uncertainty over time, and snaps back when a hospital
   reports over the mesh (`C|` message). The probability of finding no bed adds an expected redirect delay.
7. **Decision**. For every facility:

   ```
   time to treatment = ambulance->patient + on-scene + patient->facility + ED wait (this triage level) + P(no bed) x redirect
   harm              = weight(triage) x (1 - exp(-time / tau))
   ```

   Hard filters: closed/diverting, unreachable, missing required capability (relaxed and flagged only if nobody has it),
   clinics for non-minor patients, no beds. The lowest-harm facility wins; the bed is reserved immediately.
8. **Audit** (`audit.py`). The full decision record goes into a SHA-256 hash-chained, append-only log. Changing any past
   record breaks the chain (`GET /api/audit` verifies it). The latest hash can be published when connectivity returns.

## Using the MedMesh profile (filled before the disaster)

Before a disaster, the app syncs the person's MedMesh profile to the command centre (`POST /api/profile`): conditions,
medications, allergies, devices they depend on (oxygen, CPAP), usual hospital, and any risk flags from the pre-disaster
screening. It is stored in the laptop's local database (`profiles` table) and reloaded at start, so it is available offline.

During the emergency only the 6-character ID travels in the SOS. The command centre looks the profile up and
`engine/patient.py` turns it into routing changes, each shown in the decision panel as "MedMesh profile: ...":

| Profile says | Effect on routing |
|---|---|
| Pregnant + bleeding / injury / unconscious | obstetric care **required** |
| On blood thinners + bleeding / fall / unconscious | urgency raised, trauma care preferred |
| Heart condition + chest pain / breathing / unconscious | cardiac care preferred, time window tightened |
| Lung condition + breathing difficulty | time window tightened, priority raised |
| Kidney disease | dialysis-capable hospital preferred |
| Diabetic + unconscious | possible low blood sugar flagged |
| Oxygen / breathing device | needs a bed with oxygen on arrival |
| Child / age 75+ with a fall or injury | paediatric care preferred / time window tightened |
| Usual hospital on file | small bonus (records and specialists there) |

Unknown ID (profile never synced): the engine falls back to what the bystander entered in the SOS (blood group,
allergy, condition codes).

## Mass casualty mode

`POST /api/engine/batch` re-plans all active patients **jointly**: a linear assignment problem (Hungarian algorithm)
over hospital bed slots, where each extra patient sent to the same hospital sees a longer predicted queue. It reports the
expected harm of the joint plan against first-come-first-served.

## Supplies

`supply.py` covers a multi-item order from the fewest, closest pharmacies: an exact weighted set-multicover
(branch-and-bound over subsets) for up to 14 candidate pharmacies, greedy approximation above that, with order splitting
and shortfall reporting.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/decision/{case}` | full decision record: every facility, every factor, eliminations, explanation, compute time |
| `GET /api/engine` | per-facility queue model (arrivals/hr, utilisation, wait by triage level) and bed nowcast |
| `POST /api/engine/batch` | joint re-optimisation vs first-come-first-served |
| `GET /api/audit` | audit log tail + chain verification |

## Measured performance (`python bench.py`)

| Network | One patient vs all facilities | Joint assignment |
|---|---|---|
| Demo map (90 segments, 4 facilities) | ~1 ms | ~9 ms for 12 patients |
| Synthetic city grid (28,560 segments, 30 facilities) | ~19 ms median | ~0.8 s for 40 patients |

## Modelling assumptions (stated, tunable, shown in the dashboard)

- Time constants τ per complaint, triage weights, on-scene times, redirect delay: encode "faster matters more for
  these conditions"; not clinical outcome data.
- Baseline ED class mix (10% red / 35% yellow / 55% green) and mean treatment times.
- Hospital figures in `data.py` are demo values until official data (CIHI beds, Ontario Health ED times) is loaded.

## Tests

`python base/tests/test_engine.py`: Erlang C against a textbook value, calibration, priority ordering, cardiac routing,
clinic routing for minor patients, flood rerouting, bed reservation, Kalman behaviour, batch never worse than FCFS,
supply optimality against brute force, duplicate merging rules, audit tamper detection.
