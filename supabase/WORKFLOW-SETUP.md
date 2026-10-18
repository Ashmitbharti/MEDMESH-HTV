# Workflow setup

## Software walkthrough

Start Expo with `npm run web -- --localhost` or `npx expo start --go --tunnel` for Expo Go. Use the regular role entry screens:

1. Enter as Citizen → the filled profile opens directly and its ID is registered with Supabase → hold SOS → complete and send the report.
2. Command Center: SOS → dispatch an available ambulance → assign a hospital.
3. Hospital: choose that hospital → Incoming → confirm arrival.
4. Hospital: Supplies → request medicine.
5. Command Center: Supplies → assign a pharmacy with stock.
6. Pharmacy: choose that pharmacy → approve or decline.
7. Hospital: Supplies shows the approved request closed. Citizen Status shows arrival.

Command Center uses access code `111111`. Hospitals use HosID `100001`–`100003`; pharmacies use PharmID `200001`–`200003`. These entry codes select the workspace. Supabase operator/staff permissions are still required to read and act on protected SOS records. The SOS screen shows the SQL needed to link the current session when access is missing. Separate devices each need their own session linked. Demo account buttons and Test Kit access have been removed.

Approval means the order was approved and routed; it does not prove physical delivery.

## Supabase

Apply existing migrations in timestamp order, including [20261018000000_direct_supply_approval.sql](migrations/20261018000000_direct_supply_approval.sql). For an already migrated project, run this new migration in the Supabase SQL editor or deploy it through your normal migration process. It reuses existing supply and stock tables and adds the atomic approval function used by the app.

The approval function was confirmed present in the configured live project during the final checks. This code change did not deploy it.

Cloud access still requires the existing authenticated sessions, RLS policies, hospital staff membership and Command Center operator records. MedMesh ID entry selects a local citizen identity; it does not grant access to someone else's private medical profile. Staff email sign-in remains available.

## Tables retained

All 11 tables defined by the repository migrations are used directly or support permissions and relationships: `medical_profiles`, `hospital_networks`, `hospitals`, `hospital_staff`, `hospital_status`, `pharmacies`, `pharmacy_status`, `supply_requests`, `command_operators`, `emergency_requests`, and `emergency_events`.

No redundant table was identified in this schema, so no table drops were added. The live database has not been audited or modified.

## Checks performed

- Mobile web walkthrough: citizen SOS → Command Center dispatch → hospital arrival → citizen arrival status.
- Mobile web walkthrough: hospital request → Command Center pharmacy assignment → pharmacy approval → closed request at hospital.
- `node workflow/workflow.test.cjs`: ambulance conflicts, bed reservations, stale assignments, hospital authorization, stock deduction, declines and repeated approvals.
- JavaScript syntax and relative import checks.

The final browser walkthrough used isolated network fixtures and separate role sessions. Live Supabase directory reads, anonymous sign-in and database function validation were checked separately. Live staff assignment permissions, physical radios and native phone behavior were not tested.

## AI deployment required

The configured live project returned 404 for `sos-interpret`, `pdf-autofill` and `emergency-pack` during final checks. Deploy these three Edge Functions from this repository and configure the server's `GEMINI_API_KEY`. Their JavaScript entry points are declared in `supabase/config.toml`.

Until deployed, SOS interpretation uses the offline rules, emergency packs fall back to English, and report autofill cannot read uploaded files. A publishable app key cannot deploy functions or configure server secrets.
