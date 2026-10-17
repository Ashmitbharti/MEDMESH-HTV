# Sign-in and citizen dashboard

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/welcome` | Sign-in | 3D mesh radar (drag to rotate). Real email sign-in for **Citizen / Hospital / Pharmacy**, plus three demo accounts that need no internet |
| `/` | Citizen dashboard | Greeting, weather backdrop, **the Shield**, four actions, emergency contact, link status |
| `/sos` | SOS flow | Ashmit's flow (hold 3 s → identify → 5-second questions → summary), restyled, with one-tap GPS |
| `/medicine` | Find medicine | Builds `M|id|ITEM|urgency|travel|lat,lon|medmeshID` |
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

## Not wired yet

Messages queue on the phone (`dashboard/outbox.js`) in the command centre's exact wire format. The next step is the transport: the phone sends them over Bluetooth to a Meshtastic node, or over Wi-Fi to the command centre in simulator mode.
