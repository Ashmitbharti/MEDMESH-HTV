# Sign-in and citizen dashboard

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/welcome` | Sign-in | 3D mesh radar (drag to rotate). Real email sign-in for **Citizen / Hospital / Pharmacy**, plus three demo accounts that need no internet |
| `/` | Citizen dashboard | Greeting, weather backdrop, **the Shield**, four actions, emergency contact, link status |
| `/sos` | Emergency report | Own words in any language (Gemini fills the form) or tap answers · GPS · how many people · one card per person (START questions, injury, age, note, optional QR) · scene alert first · live status per person |
| `/medicine` | Medicine & supplies | Medicines + oxygen/equipment, suggestions from the MedMesh ID, oxygen "how much is left" (< 2 h → SOS), pickup/delivery, live tracker with pickup code |
| `/safe` | I'm safe | Builds `O|id|SAFE or NEED|name|lat,lon` |
| `/status` | Status | Hospital on top, ambulance ETA, live offline map, contact texting, timeline, messages |
| `/guides`, `/guide?id=` | First aid | 3D guides, recommended by hazard + MedMesh ID, read aloud in the pack language |
| `/cpr` | CPR coach | 110/min beat (sound + vibration), 3D chest target, voice coaching, ambulance ETA, keeps screen awake |
| `/road` | Report a road | Blocked / flooded / debris / fire, tap the tilted offline map, nearest road name, confirmation status |
| `/profile` | My ID | MedMesh ID |
| `/hospital`, `/pharmacy` | Placeholders | The next dashboards to build |

## Test accounts

- **Demo (offline):** tap a demo account on the sign-in page.
- **Real (Supabase):** choose the role on the sign-in page, then "Create an account". The role is saved in `user_metadata.role`. For quick testing, turn off "Confirm email" under Supabase → Authentication → Providers → Email.
- Once signed in, the account is kept on the phone, so the app still opens with no network.

## Weather backdrop: where the disaster type comes from

1. **The command centre.** `GET /api/hazard`. To set it: `POST /api/hazard {"type":"STORM","area":"Scarborough"}`. It is also broadcast over the mesh as `X|STORM|WARN|Scarborough` (24 bytes), so phones can learn it with no internet.
2. **Live weather at the phone's GPS position** (Open-Meteo, no key needed), when online.
3. **The last saved alert** (kept for 48 h).
4. **Otherwise neutral.** The app never guesses.

GPS works offline. The chip under the greeting always shows the source.
**Demo switch:** long-press the weather chip to cycle storm → flood → snow → wildfire → earthquake → rain → clear. Signing out clears it.

## Env

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
EXPO_PUBLIC_COMMAND_CENTRE_URL=http://<laptop-ip>:8765
```

## Emergency report details

- **Own words, any language:** the phone tries the command centre (`/api/interpret`, Gemini on the laptop), then the `sos-interpret` Supabase function, then a small offline keyword reader (English, French, Spanish, romanised Hindi). The result is always shown for the person to check before sending. "Just send my words" sends the text as `V|` and the command centre fills the form.
- **To speak instead of typing:** use the microphone on the phone keyboard. It works in any language the keyboard supports, often offline.
- **"Not sure" counts as urgent.** Unknown answers are treated as possibly serious, so missing information never moves someone down the queue.
- **Several people:** `Z|scene|count|lat,lon|cause` goes first, so several ambulances can start. Then one `R|` per person with `INC:scene`. The command centre spreads them across hospitals by severity.
- **"I'm in trouble":** if the person stops interacting for 30 s, what is known is sent automatically.

## Gemini key (never in the app)

- Command centre: `export GEMINI_API_KEY=...` before `python3 server.py`.
- Supabase (online phones): `supabase secrets set GEMINI_API_KEY=...`, then `supabase functions deploy sos-interpret`.
- Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`).

## Sending

`link/meshLink.js` sends the outbox. With `EXPO_PUBLIC_COMMAND_CENTRE_URL` set and the command centre started with `--sim`, it uses the command centre's simulated mesh over Wi-Fi (`/api/sim/send` and `/api/sim/inbox`), so replies such as acks, ambulance assignments and pharmacy answers come back to the phone.

## Personal emergency pack (Gemini)

At MedMesh ID setup (online) the person picks a language. The app sends **our checked English first-aid lines**
(chosen and personalised by fixed rules from the ID: blood thinners, diabetes, home oxygen...) to the command centre
`/api/pack` (or the `emergency-pack` Supabase function). Gemini **translates** them, **back-translates** each line
(numbers are checked in any script; a failing line stays in English) and **voices** the life-saving lines. Text and
WAV clips are saved on the phone and play offline. Gemini never writes medical advice. Content in
`firstaid/content.js` must be reviewed by a clinician before a real release.

## Bluetooth

The banner above every form points to the nearest MedMesh node (GPS, offline) and connects over Bluetooth with the
official Meshtastic library (Web Bluetooth: Chrome on Android/laptop, Bluefy on iPhone, https only). The installed
app needs a development build with a native Bluetooth transport for the same library.

## Testing without a Gemini key

`python3 base/tests/mock_gemini.py 8790`, then start the command centre with
`GEMINI_API_KEY=test GEMINI_API_BASE=http://127.0.0.1:8790/v1beta`. Every Gemini path (SOS form, pack + voice,
review findings) then runs end to end. Build the web app with `npx expo export --platform web --clear` when you
change `EXPO_PUBLIC_*` values (the bundler caches them otherwise).

## Not wired yet

Native (non-browser) Bluetooth transport for the installed app. Hospital and pharmacy dashboards.

## Hospital login (3 tabs)

Sign in with the hospital demo account (Centenary Hospital). The device joins the mesh as `HOSP_<id>` (`J|H|CEN|…`).

- **Hospital**: the 3D Bed Tower (ICU / beds / ER floors; glowing cubes are free beds, the ground aura is the status).
  Edit status, beds, ICU, ER bays and wait (lists with a Custom option), capabilities and a note, then send one
  `C|CEN|free|icu|caps|open|wait|note` message. A freshness card explains that routing trusts recent numbers more.
- **Incoming**: patients the command centre is sending here (`I|…`), placed on 3D arrival rings by ETA and coloured by
  its triage. Cards show complaint, age, blood group, allergies, a get-ready checklist, and send `HA|id|READY`.
  "We're full" sends `HA|…|FULL`: the hospital stops receiving new patients and ambulances not yet carrying a patient are re-routed.
  `IU` keeps arrivals current; `ZA` shows multi-casualty scenes.
- **Supplies**: fair-price requests to every pharmacy and supplier at once (`S|…`). The cap is normal price + 10%;
  sellers above it are skipped and logged in the hash-chained audit log, unless the hospital knowingly allows them
  for a critical shortage (`|ALLOW`, also logged). Prices are demo values.

## Pharmacy login (3 tabs)

Sign in with the pharmacy demo account (Care IDA Pharmacy). The device joins as `PHARM_<id>` (`J|X|MSP|…`).

- **Requests**: the 3D Beacon (a turning pharmacy cross; ripples = requests waiting). People nearby (`MR`, asked of up to
  3 places at once, with distance and whether the item matches their MedMesh ID, never who they are): answer "We have it,
  ready in 10/20/30/60 min" or "Don't have it" (`PA`). If chosen (`MK`) the pickup code shows, then "Handed over" or
  "Can't after all" (`PR|id|DONE/OUT`; OUT re-asks other places). Hospital orders (`SR`) get quick replies
  Ready / Runner / Only part / Can't (`PR`), which reach the hospital's Supplies tab as `SU`.
- **Stock**: the 3D Shelf (glass bottles, liquid level = stock; green/amber/red; red price tag = above the cap). Edit
  count (Out / Low / Full shortcuts) and price, with the fair-price cap shown live. Only changed items go out (`P|…`).
  Stock the command centre already took off (requests won, hospital orders) is mirrored automatically.
- **Nearby**: the 3D Demand Rose (8 directions, near and far columns) and items asked within 5 km in the last 6 h
  (`ND`, counts only), with restock hints.

The command centre now asks fair-priced places first; an over-cap place is asked only when no fair one has stock.
