# MedMesh

**Emergency help that works when the networks don't.**

On July 8, 2022, the Rogers outage cut off wireless and wireline services for **more than 12 million customers** and disrupted access to **9-1-1**. An emergency shouldn't have to wait for the network to come back. [CBC News](https://www.cbc.ca/news/politics/rogers-outage-human-error-system-deficiencies-1.7255641) · [CRTC assessment](https://crtc.gc.ca/eng/publications/reports/xona2024.htm)

MedMesh is an offline emergency network built on a LoRa radio mesh (Meshtastic). When storms, floods or outages take down cell service and internet, a resident's SOS still travels as a tiny radio message to a command centre. The command centre triages it, picks an ambulance, hospital and pharmacy, and flags the people and radio nodes that have gone silent, so welfare checks go to those who need them most.

Built at **Hack the Valley 11** by Ishika Sharma, Banaj Bhasin, Ashmit Bharti and Shiven Sharma.

[Devpost](https://devpost.com/software/medmesh) · [Demo video](https://www.youtube.com/watch?v=6FrSV2yrKUQ)

---

## What is the problem ??

Storms, floods and outages cut networks, and the people who depend on help most go silent first: older people living alone, people on home oxygen, people with mobility or medical needs. MedMesh keeps them connected and tells responders who has stopped answering.

## What it does

- **Works with no cell service or internet.** Messages travel over a Meshtastic LoRa mesh between Heltec boards.
- **MedMesh ID.** Residents set up a medical ID (blood type, allergies, conditions, medications) before a crisis. Only a short 6-letter ID travels over the radio; the command centre already holds the profile.
- **Hold-to-send SOS.** Hold the SOS button for 3 seconds (releasing early cancels), then answer a short questionnaire by typing or speaking. The report goes out as a compact pipe-separated message that fits one LoRa packet.
- **Command centre.** A FastAPI server reads packets from a gateway board, runs START-style triage, and assigns an ambulance, hospital and pharmacy using Dijkstra routing over a road network, with hospital capacity and queueing models.
- **Silent-resident and silent-node alerts.** The command centre flags residents and radio nodes that stop responding.
- **AI assists, people decide.** Gemini drafts a triage summary and suggests a priority, and powers a "fill the form for me" helper. A person approves the final decision. Without internet, rule-based fallbacks take over and the UI labels which one produced the text.
- **Separate views** for citizens, hospitals, pharmacies and government.
- **Offline first aid.** CPR coach with a metronome, and step-by-step guides.
- **FloodSense (Model B).** Estimates next-day creek high-water risk from 11 Toronto-area Water Survey of Canada gauges plus rain data, to warn about road and relay risk ahead of a storm.
- **Link health (Model A, experimental).** A link-failure model trained on **simulated** data.

## Repository layout

| Path | What it is |
|---|---|
| `src/app/` + feature folders (`dashboard/`, `emergency/`, `medmesh-id/`, `firstaid/`, `hospital/`, `pharmacy/`, `government/`, ...) | Expo app: citizen, hospital, pharmacy and government screens |
| `link/`, `cloud/`, `lib/`, `auth/` | Mesh connection (Wi-Fi sim or Bluetooth), Supabase sync and auth |
| `command-centre/base/` | FastAPI command centre: mesh bridge, triage, routing, dispatch engine |
| `command-centre/app/` | Offline phone web app served at `/app/` |
| `supabase/` | Migrations and edge functions (Gemini helpers) |
| `floodsense/` | Flood-risk models for 11 creek gauges |
| `node-link-health/linkhealth/` | Link-failure model (simulated data) |

## Run locally

You need Node.js with npm and Python 3.11 or newer. The simulator works without LoRa boards or API keys.

```bash
git clone https://github.com/Ashmitbharti/MEDMESH-HTV.git
cd MEDMESH-HTV
npm install
python -m venv .venv
```

Activate the Python environment with `source .venv/bin/activate` on macOS/Linux, or `.\.venv\Scripts\Activate.ps1` in Windows PowerShell. Then start the command centre:

```bash
python -m pip install -r command-centre/base/requirements.txt
python command-centre/base/server.py --sim
```

Open [localhost:8000](http://localhost:8000) for the command-centre dashboard. Keep this terminal running.

Create a `.env` file in the project root:

```dotenv
EXPO_PUBLIC_COMMAND_CENTRE_URL=http://127.0.0.1:8000
EXPO_PUBLIC_MESH_NODE=FIELD
```

In a second terminal, from the project root:

```bash
npm run web -- --localhost
```

Open the address Expo prints, choose a role, then select a demo account. Use **Test kit** to send sample emergencies, medicine requests and weather alerts. Keep both terminals running. Restart Expo after changing `.env`.

For a phone on the same Wi-Fi, use the laptop's local IP instead of `127.0.0.1` in `.env` and run `npm start`. Supabase and Gemini setup is optional for the local demo; real sign-in, report extraction and generated emergency packs need their backend credentials.

## Hardware used

- Heltec WiFi LoRa 32 V3 boards running Meshtastic firmware.
- One gateway board on the command-centre laptop (USB); the other boards are field nodes and relays.
- All boards must share the same channel name, key, region and preset, or they will not see each other.

## FloodSense

FloodSense estimates, for 11 Toronto-area creek gauges (Water Survey of Canada), the chance that **tomorrow's** daily creek level will be above that gauge's own 95th percentile. A distance-weighted combiner turns those gauge scores into a flood-risk score for any relay or road segment (inverse-square weights, 15 km radius, no score if no gauge is in range, readings older than 3 hours flagged stale).

- **Method:** gauge level and discharge trends plus rain features, with logistic regression, random forest, LightGBM and XGBoost tuned per gauge on a chronological 70/15/15 split. Two alert levels: **WATCH** (F2-optimal) and **WARNING** (at least 50% validation precision).
- **Held-out results:** on 10 of the 11 gauges, WATCH catches 47–80% of high-water days (for example Mimico 39 of 45 events, East Humber 15 of 17). Precision is 13–51%, so there are false alarms, and the model beats a "tomorrow = today" baseline at every gauge. Cooksville Creek is excluded because it has too few high-water events to validate. Per-gauge numbers are in `floodsense/results/fleet_results.csv`.
- **Known floods:** on 2024-07-16 the Mimico model issued WARNING the day before, and that date is in its test split. On 2024-08-17 it issued NONE the day before and WARNING on the day. The 2013 flood is in the training period, so it doesn't count as evidence.
- **Limits:** the label is creek high water, not street flooding. Data is daily, so the horizon is "tomorrow", not "next hour". Scores between gauges are estimates.

## Link health (experimental)

`node-link-health/linkhealth/` holds a model that scores the risk that a mesh node's link fails within a short horizon from SNR, RSSI, hop count, packet rate and time since last packet. A failure is defined as a node silent for 90 seconds or more.

- It is trained on **simulated** packet streams (scenarios such as baseline, walk-out, obstruction, hard unplug, slow fade, water in bag)

## Limitations and honest notes

- Range and reliability are hardware limits: indoor boards and stock antennas sometimes could not see each other. Radio performance depends more on antennas, height, walls and connectors than on settings.
- LoRa messages are tiny, so the protocol is compact and tolerates messages that arrive late or never arrive.
- Health data needs a privacy review before any real-world pilot. Keys must be rotated and the system hardened before any deployment.
- Demo data (residents, hospital capacity, stock, prices) is simulated.

## What's next

- Train the link-failure model on real recordings and give a "link at risk" score before a node goes silent.
- Test with more nodes, better antennas and real outdoor range.
- Connect FloodSense risk to the command-centre road routing.
- Pilot with a care team or community group after a privacy review.

## Data sources and credits

- Hydrometric gauge data: Water Survey of Canada / Environment and Climate Change Canada (GeoMet OGC API).
- Rain data: Environment and Climate Change Canada climate stations.
- Map data: © OpenStreetMap contributors (ODbL), when `prepare_map.py` is used.
- Hospital and pharmacy names, addresses and total beds from public sources (SHN, Ontario Health atHome directory); all other facility figures are simulated.
- Radio: [Meshtastic](https://meshtastic.org).

## Built with

Arduino, ESP32, Expo, React Native, TypeScript, FastAPI, Python, Meshtastic, LoRa (Heltec WiFi LoRa 32 V3), Gemini, Supabase, scikit-learn, LightGBM, XGBoost.
