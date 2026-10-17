# MedMesh

Offline emergency coordination over a LoRa mesh. No cell service, no internet.

```
Phone (MedMesh app) ──Bluetooth──> FIELD node ~~LoRa~~> RELAY ~~LoRa~~> BASE node ──USB──> Laptop (command centre)
                                                      (self-heals: if RELAY dies, RESP carries it)
```

| Folder | What it is |
|---|---|
| `app/` | **MedMesh mobile app** (installable web app). Roles: Patient, Responder, Hospital, Pharmacy |
| `base/` | **Command centre**: Python bridge to the BASE board, decision logic, SQLite log, offline AI, 3D dashboard |
| `PROTOCOL.md` | Every LoRa message format (all < 200 bytes) |

---

## 1. Try it now without hardware (simulator)

```bash
cd base
pip install -r requirements.txt
python server.py --sim
```
- Dashboard: **http://localhost:8000** → press **▶ Run sample scenario**
- App: **http://localhost:8000/app/** → pick a role → **Connect simulator** (FIELD for patient, RESP for responder, HOSP / PHARM for hospital / pharmacy)
- On a phone on the same Wi-Fi: `http://<laptop-ip>:8000/app/`, base address `http://<laptop-ip>:8000`
- **Flood node** buttons in "Mesh network" kill a node; reports then travel FIELD → RESP → BASE instead.

## 1b. Phone app without hardware (linked to your Mac's command centre)

Your phone needs an **https** link to the Mac. One command makes one (no install, uses the Mac's built-in ssh):

```bash
ssh -R 80:localhost:8000 nokey@localhost.run
```
It prints a link like `https://abc123.lhr.life`. On your phone open **`https://abc123.lhr.life/app/`** → role → **Connect simulator** (base address is filled in automatically). Keep that Terminal open. The link changes each time you run it.

## 2. Run with the real boards

**Boards (Meshtastic, done once):** all 4 on Region **US**, same private channel/key. Name them `FIELD`, `RELAY`, `RESP`, `BASE`. RELAY role = **Router**. Optional: Module Config → External Notification → LED on message.

**Command centre (laptop):**
1. Plug the **BASE** board into the laptop over USB. Close any browser tab using it (only one program can use the USB port).
2. `cd base && python server.py` (auto-detects the port, or `--port /dev/cu.usbserial-XXXX`; on Windows `--port COM5`)
3. Open http://localhost:8000

**Phones:** the app must be opened from an **https** address for Bluetooth to work:
- Easiest: drag the `app/` folder onto **https://app.netlify.com/drop**, or publish it with GitHub Pages.
- **Android:** open the https link in **Chrome** → menu → *Add to Home screen*.
- **iPhone:** Safari has no Web Bluetooth. Open the https link in the free **Bluefy** browser.
- In the app: pick a role → **Bluetooth node** → choose the nearest board. Turn Bluetooth on; disconnect the official Meshtastic app first (a board accepts one phone at a time).
- Laptop fallback: the same app on a laptop with a board on USB → **USB cable**.

After opening once with internet, the app works fully offline (service worker cache).

## 3. Maps, routing and live traffic (all offline)

- **Real street map:** on your Mac, with internet, once:
  ```bash
  pip3 install osmnx
  cd base && python3 prepare_map.py        # Scarborough, 6 km around UTSC (~20-50 MB)
  ```
  This saves `base/map.json` (real roads with curves, speed limits, water, parks, buildings from OpenStreetMap). Restart `server.py`; it also copies the map into `app/area.json`, so **redeploy the `app/` folder** to Netlify so phones get the real map too. Until then a simplified grid of real Scarborough roads is used.
- **Routing:** fastest path by travel time (Dijkstra) on the offline road graph, with turn-by-turn steps. Same idea as Google Maps directions, but it runs on the laptop and on the phone with no internet.
- **Congestion (instead of Google's online traffic):**
  - **Blocked** roads are removed (responder `B|`, or dashboard).
  - **Slow** roads count 3× slower but stay usable (responder "slow traffic" or dashboard *Mark slow*, e.g. evacuation routes).
  - **Live traffic:** ambulances send GPS over the mesh (responder app every 30 s, or the board's own position packets). The base compares their speed with the limit on that road, learns a congestion factor, and reroutes any ambulance that would be faster another way.
  - Simulator: **Hidden jam** creates a jam the base doesn't know about; watch the ambulance slow down, the road turn red, and the route switch.
- Responders tap **🗺 Navigate** on a dispatch: the phone draws the route on its offline map and shows each road with distances.

## 4. Optional: offline AI

- **AI** (SBAR handoff notes + situation summary): install [Ollama](https://ollama.com), then `ollama pull llama3.2:3b`. Without it, MedMesh uses clear templates, so the demo never breaks. Change the model with `MEDMESH_MODEL=...`.

## 5. How the decisions work

- **Triage:** START rules computed on the phone *and* re-checked at base (walks → MINOR; not breathing → EXPECTANT; breathing fast / heavy bleeding / not responding → IMMEDIATE; else DELAYED).
- **Hospital pick:** filter (open, free beds, required capability: chest pain→cardiac, burn→burns, pregnancy→obstetrics, bleeding/fracture→trauma, reachable by road) → score = drive time (×2 if IMMEDIATE) + 10 × fullness (+5 if a child and no paeds). Lowest wins. If no hospital has the capability, it relaxes the filter and flags it.
- **Routing:** Dijkstra on travel time over the offline road graph. Blocked roads and flood zones are removed, then every active ambulance whose route used them is re-routed and messaged (`RR`). Closing a hospital also reroutes its incoming patients.
- **Medical ID:** only a 6-letter ID crosses the air; the base looks the profile up locally (synced before the disaster). Bystanders can scan the patient's QR or type the code from the lock-screen Medical ID.
- **Red flags:** rule-based and deterministic, each with its reason. The AI only words notes; it never diagnoses. Clinicians tick each flag to confirm.
- **Pharmacy:** `M` → nearest open pharmacy with stock → `MR` to its phone → accept/decline (declines move to the next pharmacy) → `MA` back to patient, or a delivery task `T` for a responder.
- **Supplies:** hospital `S` → split across nearest pharmacies with stock → `SR` / `SA`.

## 6. Demo script (≈2 min)

1. Dashboard on the projector, patient phone mirrored (Android: `scrcpy`; iPhone: QuickTime).
2. Patient taps **GET HELP**, answers 8 taps, **It's me** (Medical ID), **SEND**. Phone shows ✓ sent → ✓ across the mesh → ✓✓ received.
3. Dashboard: red case pops up, AI SBAR note shows **O−, penicillin allergy, on warfarin**, Centenary chosen with the scoring table, route drawn. Responder phone buzzes with the dispatch.
4. **Self-healing:** unplug RELAY ("flooded") → send again → it arrives via RESP.
5. **Reroute:** responder reports *Ellesmere Rd flooded* → route redraws, responder gets `RR`, patient gets "route changed".
6. **Live traffic:** (sim) *Hidden jam* on the ambulance's road → it slows to ~10 km/h, the road turns red, MedMesh reroutes. "That's Google-style traffic, learned over a radio mesh."
7. Close: hospital lowers beds to 0 live → next patient goes elsewhere.

All hospital capacity, pharmacy stock and patient profiles are **simulated demo data**.

## Quick start

- **App (web):** `npm install` then `sh build.sh` builds `app/app.js`. Serve the `app/` folder and open it in Chrome.
- **Command centre:** `cd base && pip install -r requirements.txt && python server.py --sim` (or `--port <serial port>` with the CMD board), then open http://localhost:8000
- **Real road map (needs internet once):** `pip install osmnx && python base/prepare_map.py`
- **Dispatch engine:** see `base/ENGINE.md`. Tests: `python base/tests/test_engine.py`. Benchmark: `cd base && python bench.py`
- **Message formats:** see `PROTOCOL.md`.


## Gemini (optional)

`export GEMINI_API_KEY=...` before starting `server.py` lets the command centre read emergency messages written in any
language (`/api/interpret` and mesh `V|` messages). Without a key, a small offline keyword reader is used. Never commit the key.

## New command-centre features

- **Citizen road reports** (`RD`): one report slows a road, a second person / responder / sensor confirms it.
- **Emergency pack** (`POST /api/pack`): Gemini translates and voices the app's checked first-aid lines; numbers verified.
- **After-action review** (`/review`): a 7-slide deck from this run's records; Gemini findings must cite real data.
- **Testing without a key:** `python3 base/tests/mock_gemini.py 8790` and start the server with
  `GEMINI_API_KEY=test GEMINI_API_BASE=http://127.0.0.1:8790/v1beta`.
