# Testing MedMesh end to end

## 1. Start the command centre (laptop)

```bash
cd base
pip install -r requirements.txt
# optional, for the Gemini features: put the key in your shell, never in the app or git
export GEMINI_API_KEY=...            # or skip it: everything falls back to built-in rules
python3 server.py --sim --http 8765  # simulated 4-node mesh, dashboard at http://localhost:8765
```

## 2. Start the app

```bash
cd app-folder            # this repo
npm install
echo "EXPO_PUBLIC_COMMAND_CENTRE_URL=http://<laptop-ip>:8765" > .env   # same Wi-Fi as the phone
npx expo start --clear   # scan the QR code with Expo Go, or press w for the browser
```

Find `<laptop-ip>` with `ipconfig getifaddr en0` (Mac) or `ipconfig` (Windows). Use the IP, not `localhost`, on a phone.

## 3. Demo accounts (Welcome screen → "Try a demo account")

| Account | Role | What to test |
|---|---|---|
| Margaret | Citizen | Ready MedMesh ID (ZP5W1K, home oxygen, lives alone, opted in to the watchlist): SOS, Status, Supplies, I'm safe, first aid, CPR coach, road reports |
| New citizen | Citizen | Empty phone: the MedMesh ID setup questions, report upload with Gemini |
| Centenary Hospital | Hospital | Bed tower updates, Incoming patients, fair-price Supplies |
| SHN General Hospital | Hospital | Same, for a second hospital (busy ER) |
| Care IDA Pharmacy | Pharmacy | Requests, hospital orders, Stock shelf, Nearby needs (fair prices) |
| Ellesmere Community Rx (demo) | Pharmacy | Insulin and EpiPen priced above the cap: watch it get skipped and flagged |
| Scarborough Home Oxygen (demo) | Supplier | Oxygen and CPAP power requests |
| City Emergency Operations (demo) | Government | Overview, Analysis (Gemini findings, deck, CSV), Watchlist (wellness checks, Gemini mitigation deck) |

Test MedMesh IDs (synthetic people) to attach in an SOS for "someone else": ZP5W1K Margaret, MX4K9P Arun (diabetes, AFib),
QL7T2D Grace (pregnant 32 weeks), HV3N8R Liam (8, asthma), TB8C6M Omar (epilepsy).

## 4. Test kit (Welcome → Test kit, or the flask button on hospital, pharmacy and government screens)

Fires radio-format messages into the simulated mesh: a 3-person crash near Centenary, a chest-pain SOS with a MedMesh ID,
5 medicine requests near Care IDA (Ellesmere Rd), an oxygen request, a hospital order, a flooded road, Margaret checking in safe,
taking the relay node down, and a reset. Each card says which login shows the result.

## 5. Suggested tour (one phone)

1. Test kit → Reset. Sign in as **Centenary Hospital** → send a bed update.
2. Test kit → Car crash → Hospital → Incoming: three patients on the rings → "We are ready".
3. Sign out → **Care IDA Pharmacy** → Test kit → 5 medicine requests → answer them → Stock → Nearby.
4. Sign out → **Margaret** → I need help → report → Status. Then I'm safe.
5. Sign out → **Government** → Overview → Analysis → Write findings → Watchlist → Send a check → Build the mitigation deck.

The `dist` web build and all of this also work in a desktop browser (`npx expo start --web`).
