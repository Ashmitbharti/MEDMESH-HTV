begin;

create table if not exists public.hospital_networks (
  id text primary key,
  name text not null,
  reported_beds integer check (reported_beds >= 0),
  reporting_period text,
  capacity_scope text,
  source_url text,
  definition_source_url text,
  verified_on date not null
);

create table if not exists public.hospitals (
  hosid text primary key check (hosid ~ '^MMH-[A-Z0-9]{3,8}$'),
  slug text not null unique,
  network_id text not null references public.hospital_networks(id),
  name text not null,
  address text not null,
  phone text not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  services text[] not null default '{}',
  published_hours text not null,
  reported_beds integer check (reported_beds >= 0),
  capacity_is_simulated boolean not null default false,
  capacity_period text,
  capacity_source_url text,
  capacity_verification text not null check (capacity_verification in ('official', 'secondary_source', 'simulated', 'unknown')),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  verified_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists hospitals_network_id_idx on public.hospitals(network_id);

create table if not exists public.hospital_staff (
  user_id uuid not null references auth.users(id) on delete cascade,
  hosid text not null references public.hospitals(hosid),
  primary key (user_id, hosid)
);
create index if not exists hospital_staff_hosid_idx on public.hospital_staff(hosid);

-- Separate demo and real rows. Unknown real availability is represented by no real row.
create table if not exists public.hospital_status (
  hosid text not null references public.hospitals(hosid),
  is_simulated boolean not null,
  free_beds integer check (free_beds >= 0),
  free_icu_beds integer check (free_icu_beds >= 0),
  available_services text[] not null default '{}',
  is_open boolean,
  er_wait_minutes integer check (er_wait_minutes >= 0),
  revision bigint not null default 1 check (revision > 0),
  reported_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (hosid, is_simulated),
  check (free_icu_beds is null or free_beds is null or free_icu_beds <= free_beds)
);

create or replace function public.stamp_hospital_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.received_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_hospital_status on public.hospital_status;
create trigger stamp_hospital_status before insert or update on public.hospital_status
  for each row execute function public.stamp_hospital_status();

alter table public.hospital_networks enable row level security;
alter table public.hospitals enable row level security;
alter table public.hospital_staff enable row level security;
alter table public.hospital_status enable row level security;

revoke all on public.hospital_networks, public.hospitals, public.hospital_staff, public.hospital_status from anon, authenticated;
grant select on public.hospital_networks, public.hospitals, public.hospital_status to anon, authenticated;
grant select on public.hospital_staff to authenticated;
grant insert (hosid, is_simulated, free_beds, free_icu_beds, available_services, is_open, er_wait_minutes, reported_at)
  on public.hospital_status to authenticated;
grant update (free_beds, free_icu_beds, available_services, is_open, er_wait_minutes, reported_at)
  on public.hospital_status to authenticated;

drop policy if exists "Read public networks" on public.hospital_networks;
create policy "Read public networks" on public.hospital_networks for select to anon, authenticated using (true);
drop policy if exists "Read public hospitals" on public.hospitals;
create policy "Read public hospitals" on public.hospitals for select to anon, authenticated using (true);
drop policy if exists "Read hospital availability" on public.hospital_status;
create policy "Read hospital availability" on public.hospital_status for select to anon, authenticated using (true);
drop policy if exists "Read own hospital membership" on public.hospital_staff;
create policy "Read own hospital membership" on public.hospital_staff for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Staff create hospital availability" on public.hospital_status;
create policy "Staff create hospital availability" on public.hospital_status for insert to authenticated
  with check (exists (select 1 from public.hospital_staff staff where staff.hosid = hospital_status.hosid and staff.user_id = (select auth.uid())));
drop policy if exists "Staff update hospital availability" on public.hospital_status;
create policy "Staff update hospital availability" on public.hospital_status for update to authenticated
  using (exists (select 1 from public.hospital_staff staff where staff.hosid = hospital_status.hosid and staff.user_id = (select auth.uid())));

-- Seed data below uses published reference facts and explicitly marked demo values.

insert into public.hospital_networks (id, name, reported_beds, reporting_period, capacity_scope, source_url, definition_source_url, verified_on) values ('shn', 'Scarborough Health Network', '896', 'FY 2024/2025', 'Network-wide total; not a separate count for each hospital.', 'https://www.shn.ca/key-facts/', 'https://www.cihi.ca/en/indicators/number-of-acute-care-beds', '2026-10-17') on conflict (id) do nothing;

insert into public.hospitals (hosid, slug, network_id, name, address, phone, services, published_hours, reported_beds, capacity_is_simulated, capacity_period, capacity_source_url, capacity_verification, sources, verified_on) values ('MMH-CEN', 'shn-centenary', 'shn', 'Centenary Hospital', '2867 Ellesmere Road, Scarborough, ON M1E 4B9', '416-284-8131', array['Emergency department', 'Intensive care', 'Coronary care']::text[], 'Published emergency department hours: 24 hours, every day.', 307, false, 'Reporting year unspecified', 'https://en.wikipedia.org/wiki/Centenary_Hospital', 'secondary_source', '[{"title":"SHN published site contacts (2025–26)","url":"https://www.shn.ca/wp-content/uploads/Final-Copy-of-2025_26-Quality-Improvement-Plan-QIP-Narrative-part-1-signed.pdf"},{"title":"SHN emergency services","url":"https://www.shn.ca/areas-of-care/emergency-and-urgent-care/"},{"title":"SHN critical care services","url":"https://www.shn.ca/areas-of-care/critical-care/"}]'::jsonb, '2026-10-17') on conflict (hosid) do nothing;
insert into public.hospital_status (hosid, is_simulated, free_beds, free_icu_beds, available_services, is_open, er_wait_minutes) values ('MMH-CEN', true, 12, 2, array['Emergency department', 'Intensive care', 'Coronary care']::text[], true, 45) on conflict (hosid, is_simulated) do nothing;

insert into public.hospitals (hosid, slug, network_id, name, address, phone, services, published_hours, reported_beds, capacity_is_simulated, capacity_period, capacity_source_url, capacity_verification, sources, verified_on) values ('MMH-GEN', 'shn-general', 'shn', 'General Hospital', '3050 Lawrence Avenue East, Scarborough, ON M1P 2V5', '416-438-2911', array['Emergency department', 'Intensive care']::text[], 'Published emergency department hours: 24 hours, every day.', 556, false, 'Reporting year unspecified', 'https://en.wikipedia.org/wiki/Scarborough_General_Hospital_(Toronto)', 'secondary_source', '[{"title":"SHN published site contacts (2025–26)","url":"https://www.shn.ca/wp-content/uploads/Final-Copy-of-2025_26-Quality-Improvement-Plan-QIP-Narrative-part-1-signed.pdf"},{"title":"SHN emergency services","url":"https://www.shn.ca/areas-of-care/emergency-and-urgent-care/"},{"title":"SHN critical care services","url":"https://www.shn.ca/areas-of-care/critical-care/"}]'::jsonb, '2026-10-17') on conflict (hosid) do nothing;
insert into public.hospital_status (hosid, is_simulated, free_beds, free_icu_beds, available_services, is_open, er_wait_minutes) values ('MMH-GEN', true, 6, 1, array['Emergency department', 'Intensive care']::text[], true, 75) on conflict (hosid, is_simulated) do nothing;

insert into public.hospitals (hosid, slug, network_id, name, address, phone, services, published_hours, reported_beds, capacity_is_simulated, capacity_period, capacity_source_url, capacity_verification, sources, verified_on) values ('MMH-BIR', 'shn-birchmount', 'shn', 'Birchmount Hospital', '3030 Birchmount Road, Scarborough, ON M1W 3W3', '416-495-2400', array['Emergency department', 'Intensive care']::text[], 'Published emergency department hours: 24 hours, every day.', 250, true, 'Demo assumption', null, 'simulated', '[{"title":"SHN published site contacts (2025–26)","url":"https://www.shn.ca/wp-content/uploads/Final-Copy-of-2025_26-Quality-Improvement-Plan-QIP-Narrative-part-1-signed.pdf"},{"title":"SHN emergency services","url":"https://www.shn.ca/areas-of-care/emergency-and-urgent-care/"},{"title":"SHN critical care services","url":"https://www.shn.ca/areas-of-care/critical-care/"}]'::jsonb, '2026-10-17') on conflict (hosid) do nothing;
insert into public.hospital_status (hosid, is_simulated, free_beds, free_icu_beds, available_services, is_open, er_wait_minutes) values ('MMH-BIR', true, 18, 3, array['Emergency department', 'Intensive care']::text[], true, 30) on conflict (hosid, is_simulated) do nothing;

commit;
