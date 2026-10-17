# Hospital → pharmacy supply requests

Prerequisite: run the hospital and pharmacy migrations already prepared for this project. Then run all of `migrations/20261017050000_supply_requests.sql`, followed by `migrations/20261017060000_command_supply_routing.sql` in Supabase SQL Editor. Do not rerun the earlier supply migration after the routing migration.

Finally run `migrations/20261017070000_hospital_supply_receipt.sql` to enable hospital receipt and closure.

## Demo flow

1. Enter a hospital HosID and open Pharmacy supplies → Request medicines and supplies.
2. Enter whole quantities and choose Urgent or Routine. Send to Command Center without selecting a pharmacy.
3. A failed connection or missing migration leaves a saved local request with an explicit delivery-unconfirmed label. Retry sending uses the same request ID. Confirmed requests start as `awaiting_assignment` with no pharmacy.
4. Open Command Center with the existing demo key. Supplies → Refresh requests shows hospital requests. Select an open pharmacy with enough simulated stock and assign it. Server-side checks confirm availability. The request becomes `assigned`; quantities are not reserved yet.
5. Enter the assigned pharmacy’s PharmID. Assigned supply requests → Refresh requests loads its assigned requests. Other pharmacies do not receive them.
6. Accept and reserve stock, or Decline. Acceptance locks the request and stock row, rechecks quantities and subtracts them atomically. Repeating the same acceptance does not subtract stock twice. Command Center can reassign declined or unaccepted requests; accepted requests cannot be reassigned.
7. Mark Ready, then Confirm collected. The hospital and Command Center refresh their requests to see each confirmed state.
8. Hospital staff refresh the request and tap Received by hospital → Received and close after checking all listed supplies arrived. Supabase records receipt time, confirming account and closure time atomically. Other dashboards refresh to see Received by hospital · closed. Closed records stay in history; repeated receipt confirmation does not change stock or receipt timestamps.

The stock catalogue includes acetaminophen, ibuprofen, oral rehydration salts, wound-wash saline, dressings, gloves and antiseptic. These are demo logistics items, not prescriptions or dosing guidance. Pharmacy staff must confirm strength/formulation, dispensing requirements and suitability outside this demo. No patient details are requested or stored.

## Data and permissions

`supply_requests` stores hospital/pharmacy references, requested stock units, priority, status and timestamps. Records are explicitly simulated. Anonymous Supabase sign-in creates an authenticated demo session automatically; no per-hospital staff setup is needed for this demo.

Client direct writes are disabled. Restricted demo RPCs create unassigned requests, assign pharmacies and enforce status transitions. Assignment and acceptance check open status and stock on the server. Inventory is reserved at acceptance; two requests can be assigned the same stock, but acceptance rejects an insufficient balance. Assignment versions prevent a previous pharmacy acting on a stale assignment. Assignment history records the operator account, pharmacy and timestamp. There is no automatic pharmacy fallback or partial fulfillment.

The routing migration retires the earlier direct-send RPC permissions. Existing unaccepted direct requests are moved into the unassigned Command Center queue. Previously accepted/fulfilled requests are preserved.

Actual hospital records and real pharmacy stock are not modified by these demo functions. Use real staff authorization before connecting real operations. There is no LoRa transmission, delivery courier integration or automatic refresh yet. Collected is an explicit staff confirmation, not an inferred delivery.

Collected confirms pickup from the pharmacy, not delivery to the hospital. Only the hospital dashboard exposes receipt/close controls. The demo receipt RPC checks that the selected hospital matches the request and that its status is collected. It does not implement production staff-role authentication or partial receipt.

The Command Center key is a local demo gate, not server-side role authentication. Authenticated demo participants can operate simulated request RPCs; production operator/staff authorization is still required before real use.

Catalogue context: https://www.unicef.org/supply/interagency-emergency-health-kit
