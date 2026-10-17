begin;

create table if not exists public.pharmacies (
  id text primary key,
  entry_code text not null unique check (entry_code ~ '^[0-9]{6}$'),
  name text not null,
  area text not null,
  address text not null,
  phone text not null,
  services text[] not null default '{}',
  published_hours text not null,
  sources jsonb not null check (jsonb_typeof(sources) = 'array'),
  verified_on date not null,
  source_updated date,
  created_at timestamptz not null default now()
);

create table if not exists public.pharmacy_status (
  pharmacy_id text not null references public.pharmacies(id),
  is_simulated boolean not null,
  stock jsonb not null check (jsonb_typeof(stock) = 'object'),
  is_open boolean,
  wait_minutes integer check (wait_minutes between 0 and 10080),
  available_services text[] not null default '{}',
  reported_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (pharmacy_id, is_simulated)
);

alter table public.pharmacies enable row level security;
alter table public.pharmacy_status enable row level security;
revoke all on public.pharmacies, public.pharmacy_status from anon, authenticated;
grant select on public.pharmacies, public.pharmacy_status to anon, authenticated;
drop policy if exists "Read pharmacy directory" on public.pharmacies;
create policy "Read pharmacy directory" on public.pharmacies for select to anon, authenticated using (true);
drop policy if exists "Read pharmacy availability" on public.pharmacy_status;
create policy "Read pharmacy availability" on public.pharmacy_status for select to anon, authenticated using (true);

-- Authenticated demo sessions may update simulated inventory only, for the three seeded pharmacies.
create or replace function public.update_demo_pharmacy_status(
  p_pharmacy_id text,
  p_stock jsonb,
  p_is_open boolean,
  p_wait_minutes integer,
  p_services text[],
  p_reported_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_services text[];
  received timestamptz;
begin
  if auth.uid() is null then
    raise exception 'An app session is required' using errcode = '42501';
  end if;
  if p_pharmacy_id is null or p_pharmacy_id not in ('care-ida-ellesmere', 'food-basics-ellesmere', 'highland-creek-drugs') then
    raise exception 'Unknown demo pharmacy';
  end if;
  if p_is_open is null or p_wait_minutes is null or p_wait_minutes not between 0 and 10080
    or p_services is null or p_reported_at is null or p_stock is null then
    raise exception 'Invalid demo availability';
  end if;
  if jsonb_typeof(p_stock) <> 'object' then
    raise exception 'Stock must be an object';
  end if;
  if (select count(*) from jsonb_object_keys(p_stock)) <> 5 or exists (
    select 1 from jsonb_each(p_stock) item
    where item.key not in ('paracetamol', 'saline', 'dressings', 'gloves', 'antiseptic')
      or jsonb_typeof(item.value) <> 'number'
      or (item.value #>> '{}') !~ '^[0-9]{1,5}$'
  ) then
    raise exception 'Provide a whole stock quantity from 0 to 99999 for every catalogue item';
  end if;
  select services into allowed_services from public.pharmacies where id = p_pharmacy_id;
  if not found then
    raise exception 'Pharmacy seed data is missing';
  end if;
  if not (p_services <@ allowed_services) or array_position(p_services, null) is not null then
    raise exception 'Choose services listed for this pharmacy';
  end if;

  insert into public.pharmacy_status as current_status (
    pharmacy_id, is_simulated, stock, is_open, wait_minutes,
    available_services, reported_at, received_at, updated_by
  ) values (
    p_pharmacy_id, true, p_stock, p_is_open, p_wait_minutes,
    p_services, p_reported_at, now(), auth.uid()
  ) on conflict (pharmacy_id, is_simulated) do update set
    stock = excluded.stock,
    is_open = excluded.is_open,
    wait_minutes = excluded.wait_minutes,
    available_services = excluded.available_services,
    reported_at = excluded.reported_at,
    received_at = now(),
    updated_by = auth.uid(),
    revision = current_status.revision + 1
  returning received_at into received;
  return received;
end;
$$;

revoke all on function public.update_demo_pharmacy_status(text, jsonb, boolean, integer, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.update_demo_pharmacy_status(text, jsonb, boolean, integer, text[], timestamptz) to authenticated;

-- Published directory data and explicitly simulated stock snapshots follow.

insert into public.pharmacies (id, entry_code, name, area, address, phone, services, published_hours, sources, verified_on, source_updated) values ('care-ida-ellesmere', '200001', 'Care IDA Pharmacy', 'Ellesmere Road', '3600 Ellesmere Road, Unit 2, Scarborough, ON M1C 4Y8', '416-287-6674', array['General pharmacy', 'Blister packaging', 'Medication reviews']::text[], 'Listed hours: Mon–Thu 9am–7pm; Fri 9am–6pm; Sat 10am–3pm. Sunday not listed.', '[{"title":"Ontario Health atHome service directory","url":"https://lignesantecentre-est.ca/displayService.aspx?id=150258"}]'::jsonb, '2026-10-17', '2025-09-24') on conflict (id) do nothing;
insert into public.pharmacy_status (pharmacy_id, is_simulated, stock, is_open, wait_minutes, available_services) values ('care-ida-ellesmere', true, '{"paracetamol":120,"saline":20,"dressings":50,"gloves":200,"antiseptic":15}'::jsonb, true, 15, array['General pharmacy', 'Blister packaging', 'Medication reviews']::text[]) on conflict (pharmacy_id, is_simulated) do nothing;

insert into public.pharmacies (id, entry_code, name, area, address, phone, services, published_hours, sources, verified_on, source_updated) values ('food-basics-ellesmere', '200002', 'Food Basics Pharmacy', 'Ellesmere Road', '2900 Ellesmere Road, Scarborough, ON M1E 4B8', '416-281-0505', array['Pharmacy']::text[], 'Published pharmacy hours: Mon–Fri 9am–9pm; Sat 9am–6pm; Sun 10am–5pm.', '[{"title":"Food Basics official location","url":"https://www.foodbasics.ca/en/find-a-grocery/100863"}]'::jsonb, '2026-10-17', null) on conflict (id) do nothing;
insert into public.pharmacy_status (pharmacy_id, is_simulated, stock, is_open, wait_minutes, available_services) values ('food-basics-ellesmere', true, '{"paracetamol":80,"saline":8,"dressings":30,"gloves":100,"antiseptic":10}'::jsonb, true, 15, array['Pharmacy']::text[]) on conflict (pharmacy_id, is_simulated) do nothing;

insert into public.pharmacies (id, entry_code, name, area, address, phone, services, published_hours, sources, verified_on, source_updated) values ('highland-creek-drugs', '200003', 'Highland Creek Drugs', 'Old Kingston Road', '371 Old Kingston Road, Toronto, ON M1C 1B6', '416-286-6522', array['General pharmacy', 'Prescription delivery', 'Blister packaging', 'Medication reviews']::text[], 'Listed hours: Mon–Fri 9am–7pm; Sat–Sun 10am–3pm.', '[{"title":"Ontario Health atHome service directory","url":"https://www.centraleasthealthline.ca/displayservice.aspx?id=150690"}]'::jsonb, '2026-10-17', '2025-09-24') on conflict (id) do nothing;
insert into public.pharmacy_status (pharmacy_id, is_simulated, stock, is_open, wait_minutes, available_services) values ('highland-creek-drugs', true, '{"paracetamol":100,"saline":12,"dressings":40,"gloves":150,"antiseptic":5}'::jsonb, true, 15, array['General pharmacy', 'Prescription delivery', 'Blister packaging', 'Medication reviews']::text[]) on conflict (pharmacy_id, is_simulated) do nothing;

commit;
