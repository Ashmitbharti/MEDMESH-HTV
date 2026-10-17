begin;

create table if not exists public.medical_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  age integer not null check (age between 0 and 130),
  gender text not null check (length(trim(gender)) > 0),
  blood_group text not null check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text not null check (length(trim(allergies)) > 0),
  conditions text not null check (length(trim(conditions)) > 0),
  medications text not null check (length(trim(medications)) > 0),
  emergency_contact text not null check (length(trim(emergency_contact)) > 0),
  created_at timestamptz not null default now()
);

create or replace function public.new_medmesh_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(chr(65 + get_byte(bytes, byte_index) % 26), '' order by byte_index)
  from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as bytes) source,
       generate_series(0, 5) as offsets(byte_index);
$$;

alter table public.medical_profiles
  add column if not exists medmesh_id text not null default public.new_medmesh_id()
  check (medmesh_id ~ '^[A-Z]{6}$');
create unique index if not exists medical_profiles_medmesh_id_key
  on public.medical_profiles (medmesh_id);

alter table public.medical_profiles enable row level security;
revoke all on public.medical_profiles from anon, authenticated;
grant select, insert on public.medical_profiles to authenticated;
grant update (full_name, age, gender, blood_group, allergies, conditions, medications, emergency_contact)
  on public.medical_profiles to authenticated;

drop policy if exists "Read own medical profile" on public.medical_profiles;
create policy "Read own medical profile" on public.medical_profiles for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Create own medical profile" on public.medical_profiles;
create policy "Create own medical profile" on public.medical_profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own medical profile" on public.medical_profiles;
create policy "Update own medical profile" on public.medical_profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
