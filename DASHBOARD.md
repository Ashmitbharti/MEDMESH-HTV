# Sign-in and citizen dashboard

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/welcome` | Sign-in | 3D mesh radar (drag to rotate). Real email sign-in for **Citizen / Hospital / Pharmacy**, plus three demo accounts that need no internet |
| `/` | Citizen dashboard | Greeting, weather backdrop, **the Shield**, four actions, emergency contact, link status |
| `/sos` | Emergency report | Own words in any language (Gemini fills the form) or tap answers · GPS · how many people · one card per person (START questions, injury, age, note, optional QR) · scene alert first · live status per person |
| `/medicine` | Medicine & supplies | Medicines + oxygen/equipment, suggestions from the MedMesh ID, oxygen "how much is left" (< 2 h → SOS), pickup/delivery, live tracker with pickup code |
| `/safe` | I'm safe | Builds `O|id|SAFE or NEED|name|lat,lon` |
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

## Not wired yet

Bluetooth to a real Meshtastic node, behind the same `send()`/`subscribe()` interface as the Wi-Fi test mesh. This needs a development build.
