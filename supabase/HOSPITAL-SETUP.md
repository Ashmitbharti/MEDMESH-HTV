# Hospital database setup

Use the same Supabase project as Medical ID. This migration does not change member profiles.

1. Open Supabase → SQL Editor → New query.
2. Paste all of `migrations/20261017010000_hospitals.sql` and run it.
   Then run `migrations/20261017020000_hospital_entry_codes.sql` to add the six-digit hospital entry codes.
   Finally run `migrations/20261017030000_demo_hospital_updates.sql` once to enable simple demo updates for all three hospitals.
3. Open Table Editor. Check `hospital_networks`, `hospitals`, `hospital_status`, and `hospital_staff`.
4. Reopen Command Center → Hospitals. It should say “Hospital database loaded”.

| Hospital | MedMesh HosID |
| --- | --- |
| Centenary | 100001 (database ID MMH-CEN) |
| General | 100002 (database ID MMH-GEN) |
| Birchmount | 100003 (database ID MMH-BIR) |

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

The Hospital entry screen matches six-digit entry codes to a hospital dashboard. The code selects the hospital; it is not an authentication secret. It does not grant staff membership.

Dashboard capacity edits are demo values. They save locally first, then call `update_demo_hospital_status` under the current authenticated session. After the demo migration, no individual staff assignments are needed for simulated updates to the three seeded hospitals. Any authenticated demo participant can edit these simulated rows. The function cannot update real status, hospital identities, or staff membership. Staff assignments above still apply to direct database writes and future real hospital access.

Command Center reads Supabase when its Hospitals tab gains focus and merges pending local demo edits on the same device. There are no Realtime subscriptions or LoRa delivery yet. Separate devices require successful cloud sync and reopening the tab. Emergency assignments and pharmacy requests are explicitly shown as not connected.
