# SOS routing setup

1. After the existing hospital migrations, run `migrations/20261017080000_sos_routing.sql` in Supabase SQL Editor. This migration has not been applied automatically.
2. Open Command Center → SOS. If staff access is missing, copy the SQL shown on that device into SQL Editor and run it once, then refresh. The Command Center entry key alone does not grant database access to patient data.
3. On a separate hospital device, open its hospital dashboard and run the staff access SQL shown in Incoming emergencies once. An authorized command operator can use the hospital dashboard on the same device without another grant.

## Flow

Hold a member SOS button for three seconds. The app saves locally, sends immediately to Supabase, and syncs identification, answers and location updates as they arrive. Command Center → SOS receives the request, including unanswered-question flags.

Dispatch one of two simulated ambulances, then compare hospital free beds, ICU beds, ER wait, services and report timestamps. Hospitals are listed by ascending known ER wait; the operator selects the destination and bed type. This is not a clinical routing algorithm. The server checks current capacity and reserves a bed atomically. A general bed uses total free beds minus free ICU beds; an ICU reservation reduces both counts.

The assigned hospital sees the request in Incoming emergencies. Staff confirm **Patient received · close request** when the patient arrives. The request closes, the demo ambulance becomes available again, and the bed remains occupied. Staff adjust availability as patients are discharged.

Cancellation before dispatch closes automatically. After dispatch or assignment, Command Center must acknowledge cancellation; any reserved bed is released. Operators must coordinate ambulance stand-down separately.

## Delivery and access

- Request and hospital screens refresh every ten seconds while focused and the app is active. These are in-app inbox alerts, not background push notifications.
- Delivery currently requires internet and Supabase. Offline requests remain saved on the phone; reopen SOS or use Send / refresh when connected. No LoRa transport or real ambulance service is connected.
- Ambulance actions, beds and ER waits are simulated. Use fictional patient details for demos.
- Database policies allow only the originating account, authorized command operators and staff of the assigned hospital to read the SOS. Pharmacy/demo facility access does not grant SOS access.
- App sessions persist per device. Clearing app storage or using another device can require a new staff grant. Production deployment needs proper staff sign-in and organizational access management.
- Database functions reject stale operator actions; refresh before retrying. Two requests cannot reserve the same active ambulance, and bed reservations lock hospital capacity during allocation.

## Manual walkthrough

Create an SOS as a member, open Command Center → SOS, dispatch AMB-01 and assign a hospital. Open that hospital's dashboard and confirm arrival. Reopen the member SOS to see closure, then check Home permits a new request. Repeat with a cancelled request and a hospital with zero beds to check those paths.

Live Supabase execution and device walkthrough still need to be performed after SQL setup.
