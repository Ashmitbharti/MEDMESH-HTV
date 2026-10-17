begin;

create or replace function public.valid_demo_supply_items(p_items jsonb, p_full boolean, p_positive boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item record;
  item_count integer;
begin
  if jsonb_typeof(p_items) is distinct from 'object' then return false; end if;
  select count(*) into item_count from jsonb_object_keys(p_items);
  if item_count < 1 or item_count > 7 or (p_full and item_count <> 7) then return false; end if;
  for item in select * from jsonb_each(p_items) loop
    if item.key not in ('paracetamol', 'ibuprofen', 'ors', 'saline', 'dressings', 'gloves', 'antiseptic')
      or jsonb_typeof(item.value) <> 'number' or (item.value #>> '{}') !~ '^[0-9]{1,5}$' then return false; end if;
    if p_positive and (item.value #>> '{}')::integer < 1 then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_demo_supply_items(jsonb, boolean, boolean) from public, anon, authenticated;

-- Add demo stock for the two new catalogue entries without replacing existing stock.
update public.pharmacy_status
set stock = '{"ibuprofen":60,"ors":30}'::jsonb || stock
where is_simulated = true and pharmacy_id in ('care-ida-ellesmere', 'food-basics-ellesmere', 'highland-creek-drugs')
  and (not stock ? 'ibuprofen' or not stock ? 'ors');

create or replace function public.update_demo_pharmacy_status(
  p_pharmacy_id text, p_stock jsonb, p_is_open boolean, p_wait_minutes integer,
  p_services text[], p_reported_at timestamptz
)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  allowed_services text[];
  received timestamptz;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_pharmacy_id is null or p_pharmacy_id not in ('care-ida-ellesmere', 'food-basics-ellesmere', 'highland-creek-drugs') then
    raise exception 'Unknown demo pharmacy';
  end if;
  if p_is_open is null or p_wait_minutes is null or p_wait_minutes not between 0 and 10080
    or p_services is null or p_reported_at is null or not public.valid_demo_supply_items(p_stock, true, false) then
    raise exception 'Invalid pharmacy stock or availability';
  end if;
  select services into allowed_services from public.pharmacies where id = p_pharmacy_id;
  if not found then raise exception 'Pharmacy seed data is missing'; end if;
  if not (p_services <@ allowed_services) or array_position(p_services, null) is not null then
    raise exception 'Choose services listed for this pharmacy';
  end if;
  insert into public.pharmacy_status as current_status (
    pharmacy_id, is_simulated, stock, is_open, wait_minutes, available_services, reported_at, received_at, updated_by
  ) values (p_pharmacy_id, true, p_stock, p_is_open, p_wait_minutes, p_services, p_reported_at, now(), auth.uid())
  on conflict (pharmacy_id, is_simulated) do update set
    stock = excluded.stock, is_open = excluded.is_open, wait_minutes = excluded.wait_minutes,
    available_services = excluded.available_services, reported_at = excluded.reported_at,
    received_at = now(), updated_by = auth.uid(), revision = current_status.revision + 1
  returning received_at into received;
  return received;
end;
$$;
revoke all on function public.update_demo_pharmacy_status(text, jsonb, boolean, integer, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.update_demo_pharmacy_status(text, jsonb, boolean, integer, text[], timestamptz) to authenticated;

create table if not exists public.supply_requests (
  id text primary key check (length(id) between 10 and 100),
  hospital_id text not null references public.hospitals(hosid),
  pharmacy_id text not null references public.pharmacies(id),
  created_by uuid references auth.users(id) on delete set null,
  items jsonb not null check (jsonb_typeof(items) = 'object'),
  priority text not null check (priority in ('urgent', 'routine')),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'ready', 'collected')),
  is_simulated boolean not null default true check (is_simulated),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supply_requests_hospital_created_idx on public.supply_requests(hospital_id, created_at desc);
create index if not exists supply_requests_pharmacy_created_idx on public.supply_requests(pharmacy_id, created_at desc);
alter table public.supply_requests enable row level security;
revoke all on public.supply_requests from anon, authenticated;
grant select on public.supply_requests to authenticated;
drop policy if exists "Read simulated supply requests" on public.supply_requests;
create policy "Read simulated supply requests" on public.supply_requests for select to authenticated using (is_simulated);

create or replace function public.create_demo_supply_request(
  p_id text, p_hospital_id text, p_pharmacy_id text, p_items jsonb, p_priority text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
  availability public.pharmacy_status%rowtype;
  item record;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) not between 10 and 100 or p_id !~ '^[a-z0-9-]+$'
    or p_hospital_id is null or p_hospital_id not in ('MMH-CEN', 'MMH-GEN', 'MMH-BIR')
    or p_pharmacy_id is null or p_pharmacy_id not in ('care-ida-ellesmere', 'food-basics-ellesmere', 'highland-creek-drugs')
    or p_priority is null or p_priority not in ('urgent', 'routine') or not public.valid_demo_supply_items(p_items, false, true) then
    raise exception 'Invalid demo supply request';
  end if;
  select * into request from public.supply_requests where id = p_id;
  if found then
    if request.created_by is distinct from auth.uid() or request.hospital_id <> p_hospital_id
      or request.pharmacy_id <> p_pharmacy_id or request.items <> p_items or request.priority <> p_priority then
      raise exception 'This request ID is already in use';
    end if;
    return to_jsonb(request);
  end if;
  select * into availability from public.pharmacy_status
    where pharmacy_id = p_pharmacy_id and is_simulated = true for update;
  if not found or availability.is_open is distinct from true then raise exception 'Pharmacy is closed or availability is unknown'; end if;
  for item in select * from jsonb_each_text(p_items) loop
    if coalesce((availability.stock ->> item.key)::integer, 0) < item.value::integer then
      raise exception 'Pharmacy stock changed. Refresh and select another pharmacy or reduce quantities.';
    end if;
  end loop;
  insert into public.supply_requests (id, hospital_id, pharmacy_id, created_by, items, priority)
    values (p_id, p_hospital_id, p_pharmacy_id, auth.uid(), p_items, p_priority) returning * into request;
  return to_jsonb(request);
end;
$$;

create or replace function public.advance_demo_supply_request(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
  availability public.pharmacy_status%rowtype;
  remaining_stock jsonb;
  item record;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('accepted', 'declined', 'ready', 'collected') then raise exception 'Invalid request status'; end if;
  select * into request from public.supply_requests where id = p_id and is_simulated = true for update;
  if not found then raise exception 'Supply request not found'; end if;
  if request.status = p_status then return to_jsonb(request); end if;
  if not ((request.status = 'requested' and p_status in ('accepted', 'declined'))
    or (request.status = 'accepted' and p_status = 'ready')
    or (request.status = 'ready' and p_status = 'collected')) then
    raise exception 'Status changed. Refresh the inbox before trying again.';
  end if;
  if p_status = 'accepted' then
    select * into availability from public.pharmacy_status
      where pharmacy_id = request.pharmacy_id and is_simulated = true for update;
    if not found or availability.is_open is distinct from true then raise exception 'Pharmacy is closed or stock is unavailable'; end if;
    remaining_stock := availability.stock;
    for item in select * from jsonb_each_text(request.items) loop
      if coalesce((remaining_stock ->> item.key)::integer, 0) < item.value::integer then
        raise exception 'Insufficient stock. Refresh inventory before accepting.';
      end if;
      remaining_stock := jsonb_set(remaining_stock, array[item.key], to_jsonb((remaining_stock ->> item.key)::integer - item.value::integer));
    end loop;
    update public.pharmacy_status set stock = remaining_stock, received_at = now(), reported_at = now(),
      updated_by = auth.uid(), revision = revision + 1
      where pharmacy_id = request.pharmacy_id and is_simulated = true;
  end if;
  update public.supply_requests set status = p_status, updated_at = now() where id = p_id returning * into request;
  return to_jsonb(request);
end;
$$;

revoke all on function public.create_demo_supply_request(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.advance_demo_supply_request(text, text) from public, anon, authenticated;
grant execute on function public.create_demo_supply_request(text, text, text, jsonb, text) to authenticated;
grant execute on function public.advance_demo_supply_request(text, text) to authenticated;

commit;
