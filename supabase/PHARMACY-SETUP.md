# Pharmacy demo setup

Use the same Supabase project as the rest of MedMesh. In SQL Editor, run all of `migrations/20261017040000_pharmacies.sql` once. It creates the tables, permissions, demo save function and seed records. Rerunning it preserves existing inventory edits.

| Pharmacy | PharmID |
| --- | --- |
| Care IDA Pharmacy | 200001 |
| Food Basics Pharmacy, Ellesmere Road | 200002 |
| Highland Creek Drugs | 200003 |

Choose Pharmacy on the landing screen and enter a six-digit PharmID. Each code selects a pharmacy; it is not a staff authentication secret.

## Dashboard

- Edit open/closed status, estimated preparation time and currently available services.
- Edit simulated quantities for acetaminophen tablets, saline wound wash bottles, dressing packs, glove pairs and antiseptic bottles.
- Quantities must be whole numbers from 0 to 99,999. A demo low-stock threshold flags 10 units or fewer. Zero means out of stock.
- Save locally first, then sync to Supabase. Offline or failed updates remain pending with a Retry cloud sync button.
- Reopen Command Center → Pharmacies to refresh the cards. Pending edits are visible on the same phone. Other devices need successful cloud sync and a refresh.

## Database

`pharmacies` stores public identity, contact information, hours, services and source metadata. `pharmacy_status` stores separate simulated/real status rows, stock quantities, available services, preparation time, open status, timestamps and revisions.

The `update_demo_pharmacy_status` function permits authenticated demo sessions to update only simulated rows for these three pharmacies. Anonymous Supabase sign-in must be enabled, as for the existing member/hospital flows. No per-pharmacy staff SQL is required. Public reference data and real status rows cannot be edited through this function. Do not treat demo ID entry as production authentication.

Public details retain their original sources. Inventory, preparation times and operating states are fictional. Seed timestamps describe database insertion, not real pharmacy reports. Real availability is initially unknown.

LoRa transport, real staff access, supply request assignment, acceptance and pickup tracking are not connected. The dashboard shows the incoming request section as a placeholder.
