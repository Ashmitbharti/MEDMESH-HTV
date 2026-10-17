# Hospital database setup

Use the same Supabase project as Medical ID. This migration does not change member profiles.

1. Open Supabase → SQL Editor → New query.
2. Paste all of `migrations/20261017010000_hospitals.sql` and run it.
3. Open Table Editor. Check `hospital_networks`, `hospitals`, `hospital_status`, and `hospital_staff`.
4. Reopen Command Center → Hospitals. It should say “Hospital database loaded”.

| Hospital | MedMesh HosID |
| --- | --- |
| Centenary | MMH-CEN |
| General | MMH-GEN |
| Birchmount | MMH-BIR |

HosID is the primary key and cannot be duplicated. It is an app identifier, not an official hospital registration number. These IDs must also be used when the LoRa protocol is connected.

## Data stored

- `hospital_networks`: SHN's published network capacity, reporting period and sources.
- `hospitals`: identity, address, phone, reference services/hours, site capacity, provenance and verification date. Coordinates are nullable because exact coordinates have not been imported.
- `hospital_status`: separate simulated and real availability rows; free beds, free ICU beds, currently available care, open status, ER wait, timestamps, editor and revision. The three seeded rows are simulated. Real availability is initially unknown.
- `hospital_staff`: authorized user-to-hospital assignments. It starts empty.

Centenary/General site capacities are secondary-source figures without a reporting year. Birchmount capacity and all seeded availability are fictional. Site figures must not be summed or reconciled with the published network total.

The migration can be rerun: seeds use `on conflict do nothing` so subsequent staff edits are preserved.

## Permissions

Public reference and availability records can be read by the app. Hospital status can only be changed by authenticated users assigned to that hospital. Hospital staff cannot grant themselves membership or edit hospital identities. An administrator must add memberships through the dashboard/SQL Editor after the staff account exists:

```sql
-- Replace the example UUID with the staff user's actual auth.users ID.
insert into public.hospital_staff (user_id, hosid)
values ('00000000-0000-0000-0000-000000000000', 'MMH-CEN');
```

Use the existing publishable key in the app. Never put a service-role key or database password in Expo environment variables.

The app reads Supabase when the Hospitals tab gains focus and keeps bundled fallback data. This does not implement Realtime subscriptions, local staff editing, or LoRa delivery. Those are separate steps.
