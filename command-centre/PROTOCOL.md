# MedMesh message protocol

Every message is plain text, fields separated by `|`, and **under 200 bytes** so it fits one LoRa packet.
Phones send to the BASE node (direct message → real delivery ✓). The base replies directly to the sender.

## Phone → command centre

| Code | Format | Example | Sent by |
|---|---|---|---|
| `J` | `J|role|ref|label` (role P/R/H/X) | `J|H|CEN|Centenary` | any app on connect |
| `R` | `R|id|triage|complaint|age|count|flags|lat,lon|medmeshID|extras` | `R|a7f3|1|CP|A|1|0F10|43.7712,-79.1931|MX4K9P|` | patient |
| `M` | `M|id|item|urgency|travel|lat,lon|medmeshID` | `M|b2c1|INSULIN|N|0|43.77,-79.20|` | patient |
| `Z` | `Z|sceneid|count|lat,lon|cause|hazards|vehicles` (several casualties; sent before the per-person `R` reports, which carry `INC:sceneid`) | `Z|k3x9|3|43.78,-79.19|crash|fire,fuel|2` | patient |
| `RD` | `RD|id|BLOCK/FLOOD/DEBRIS/FIRE|lat,lon|road` (citizen road report; 1 report slows the road, a 2nd person / responder / sensor confirms it) | `RD|r1x2|FLOOD|43.776,-79.230|` | patient |
| `V` | `V|id|lat,lon|lang|text` (the caller's own words, any language; the command centre fills the form) | `V|q8w2|43.78,-79.19|es|mi hermano no responde` | patient |
| `Q` | `Q|id|complaint|lat,lon` | `Q|c9d2|BU|43.77,-79.20` | patient |
| `U` | `U|caseid|PK or DL` | `U|a7f3|PK` | responder |
| `B` | `B|road|reason` | `B|Lawrence Ave E|FLOOD` | responder |
| `F` | `F|lat,lon|radius_m` | `F|43.7650,-79.2100|400` | responder |
| `K` | `K|road|reason` (slow, 3× travel time) | `K|Hwy 401|TRAFFIC` | responder |
| `L` | `L|lat,lon` (GPS for live traffic) | `L|43.77812,-79.22051` | responder app, every 30 s |
| `C` | `C|hospID|freeBeds|icuFree|caps|open|erWaitMin|note` | `C|CEN|5|2|CTOP|1|35|No MRI` | hospital |
| `S` | `S|id|hospID|item|qty[|ALLOW]` (ALLOW = knowingly accept over-cap offers, logged) | `S|s01|CEN|INSULIN|20` | hospital |
| `HA` | `HA|caseid|READY or FULL` | `HA|a7f3|READY` | hospital |
| `P` | `P|pharmID|open|ITEM:qty[@price],...` | `P|MSP|1|INSULIN:12@41,EPIPEN:4` | pharmacy |
| `PA` | `PA|reqid|OK or NO|minutes` | `PA|b2c1|OK|30` | pharmacy |
| `O` | `O|id|SAFE or NEED|name|lat,lon|medmeshID` | `O|k1|SAFE|Margaret|43.784,-79.187|ZP5W1K` | community check-in; the optional MedMesh ID takes an opted-in person off the not-heard-from list |
| `PR` | `PR|id|READY/RUNNER/PART:n/OUT/DONE` | `PR|s9|RUNNER` | pharmacy quick reply: hospital order status, or a held item handed over / gone (re-asks others) |

## Command centre → phones

| Code | Format | Meaning |
|---|---|---|
| `A` | `A|id|OK` | received by command centre (✓✓) |
| `H` | `H|caseid|AMB/RR/PK/WAIT|minutes|text` | update for the patient |
| `D` | `D|caseid|triage|complaint|lat,lon|hospID|pickupETA+hospETA|route` | dispatch to responder |
| `RR` | `RR|caseid|hospID|eta|route` | reroute (blocked road / flood / hospital closed) |
| `T` | `T|reqid|pharmID|item|lat,lon` | delivery task for responder |
| `I` | `I|caseid|triage|complaint|age|eta|BG:x;AL:y` | incoming patient to hospital |
| `MR` | `MR|reqid|item|urgency|travel||PH1,PH2,PH3|km1,km2,km3|verified` | request to up to 3 pharmacies at once (one broadcast); each answers `PA`. The MedMesh ID field is left empty: pharmacies only get `verified` (1 = the item matches the person's MedMesh ID) and their own distance |
| `MK` | `MK|reqid|code|minutes` | to the chosen pharmacy: hold it, pickup code |
| `MX` | `MX|reqid` | to the others that said yes: taken, release it |
| `MA` | `MA|reqid|pharmID|minutes|travel|text` | medication answer to patient |
| `SR` | `SR|id|hospID|item|qty` | supply allocation to pharmacy |
| `SU` | `SU|id|pharmID|READY/RUNNER/PART:n/OUT` | a pharmacy's reply about a hospital order, to that hospital |
| `WC` | `WC|id|lat,lon|NEEDS` | wellness check for a silent opted-in person, to responders only (requested from the government watchlist) |
| `ND` | `ND|pharmID|hours|ITEM:asked/unmet,...|SECTOR:near/far,...` | anonymous demand within 5 km (counts only), to pharmacy devices |
| `SA` | `SA|id|PHARM:qty@price,...|short:n|cost:x|over:PHARM@price,...` | supply answer; over-cap sellers skipped (price cap = normal + 10%) |
| `IU` | `IU|caseid|PK/ARR/AWAY|eta` | incoming-patient update for the hospital |
| `ZA` | `ZA|scene|count|cause|hazards` | mass-casualty scene alert to hospitals |
| `W` | `W|id|siteID|eta|name|route` | "where can I go" answer |
| `AL` | `AL|caseid|lat,lon|etaMin|hospID|P or H` | where the ambulance is (P coming to you, H taking you to hospital), every 15-60 s |
| `RA` | `RA|id|PENDING or CONFIRMED|reports|road` | answer to a citizen road report |
| `CN` | `CN|caseid|QUEUED or SENT|contact name` | the emergency contact is being / has been texted |
| `X` | `X|type|severity|area` (type STORM/RAIN/FLOOD/SNOW/FIRE/QUAKE/HEAT/NONE) | active disaster, so phones can show it with no internet |

## Codes
- **Triage (START):** 1 IMMEDIATE · 2 DELAYED · 3 MINOR · 4 EXPECTANT
- **flags** (4 chars): walks 0/1 · breathing N(ormal)/F(ast)/X(none) · responds 0/1 · heavy bleeding 0/1
- **Complaint:** CP chest pain · BR breathing · BL bleeding/injury · BU burn · UN unconscious · PR pregnancy · FX fracture/fall · OT other
- **Age:** C child · A adult · S senior
- **Hospital caps:** C cardiac · T trauma · B burns · O obstetrics · P paediatrics
- **extras:** `BG:O-;AL:PEN;CX:DM,BT` · `INC:scene` · `NT:note` · `HZ:fire,fuel` (dangers at the scene) · `AI:g/o` (blood group, allergy, conditions: DM diabetes, HT heart, AS asthma, SZ epilepsy, BT blood thinners)
- **Medication urgency:** N out now · D within 24 h · 3 within 3 days
- **Items:** INSULIN INHALER EPIPEN HEART SEIZURE BP STRIPS DRESS NEB · O2 (oxygen) CPAPPWR (power for CPAP/oxygen machine) · OTHER


## Government (HTTP on the command centre's local network, not radio)

Read-only and de-identified; every view is written to the hash-chained audit log.

| Endpoint | What |
|---|---|
| `GET /api/gov/overview` | cases by triage per approximate area, hospitals, supplies, roads, mesh health |
| `GET /api/gov/analysis` | after-action metrics, case timeline, response times by area |
| `GET /api/gov/export.csv` | de-identified case table (area, triage, times, hospital) |
| `GET /api/gov/watchlist` | opt-in registry: risk by area, anonymous tokens for people not heard from |
| `POST /api/gov/wellness` | `{token}`: sends `WC` to responders; the government never sees the location |
| `POST /api/gov/mitigation` | Gemini mitigation deck; every action must cite `area:` / `need:` / `node:` facts |
