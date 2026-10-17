begin;

alter table public.supply_requests alter column pharmacy_id drop not null;
alter table public.supply_requests drop constraint if exists supply_requests_status_check;
alter table public.supply_requests alter column status set default 'awaiting_assignment';
alter table public.supply_requests add column if not exists assignment_version integer not null default 0;
alter table public.supply_requests add column if not exists assigned_at timestamptz;
alter table public.supply_requests add column if not exists assigned_by uuid references auth.users(id) on delete set null;
alter table public.supply_requests add column if not exists assignment_history jsonb not null default '[]'::jsonb;

-- Existing unaccepted direct requests return to Command Center. Preserve accepted/fulfilled requests.
update public.supply_requests set status = 'awaiting_assignment', pharmacy_id = null, updated_at = now()
where status = 'requested';
update public.supply_requests set assignment_version = 1 where pharmacy_id is not null and assignment_version = 0;
alter table public.supply_requests add constraint supply_requests_status_check
  check (status in ('awaiting_assignment', 'assigned', 'accepted', 'declined', 'ready', 'collected'));

-- Retire the direct hospital-to-pharmacy path for older app versions.
revoke all on function public.create_demo_supply_request(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.advance_demo_supply_request(text, text) from public, anon, authenticated;

create or replace function public.create_routed_demo_supply_request(
  p_id text, p_hospital_id text, p_items jsonb, p_priority text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) not between 10 and 100 or p_id !~ '^[a-z0-9-]+$'
    or p_hospital_id is null or p_hospital_id not in ('MMH-CEN', 'MMH-GEN', 'MMH-BIR')
    or p_priority is null or p_priority not in ('urgent', 'routine')
    or not public.valid_demo_supply_items(p_items, false, true) then
    raise exception 'Invalid demo supply request';
  end if;
  select * into request from public.supply_requests where id = p_id;
  if found then
    if request.created_by is distinct from auth.uid() or request.hospital_id <> p_hospital_id
      or request.items <> p_items or request.priority <> p_priority then
      raise exception 'This request ID is already in use';
    end if;
    return to_jsonb(request);
  end if;
  insert into public.supply_requests (id, hospital_id, pharmacy_id, created_by, items, priority, status)
    values (p_id, p_hospital_id, null, auth.uid(), p_items, p_priority, 'awaiting_assignment') returning * into request;
  return to_jsonb(request);
end;
$$;

create or replace function public.assign_demo_supply_request(p_id text, p_pharmacy_id text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
  availability public.pharmacy_status%rowtype;
  item record;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_pharmacy_id is null or p_pharmacy_id not in ('care-ida-ellesmere', 'food-basics-ellesmere', 'highland-creek-drugs') then
    raise exception 'Choose a demo pharmacy';
  end if;
  select * into request from public.supply_requests where id = p_id and is_simulated = true for update;
  if not found then raise exception 'Request not found'; end if;
  if request.status = 'assigned' and request.pharmacy_id = p_pharmacy_id then return to_jsonb(request); end if;
  if request.assignment_version is distinct from p_expected_version then raise exception 'Assignment changed. Refresh before assigning.'; end if;
  if request.status not in ('awaiting_assignment', 'assigned', 'declined') then
    raise exception 'This request cannot be reassigned after stock acceptance.';
  end if;
  select * into availability from public.pharmacy_status
    where pharmacy_id = p_pharmacy_id and is_simulated = true for update;
  if not found or availability.is_open is distinct from true then raise exception 'Pharmacy is closed or availability is unknown'; end if;
  for item in select * from jsonb_each_text(request.items) loop
    if coalesce((availability.stock ->> item.key)::integer, 0) < item.value::integer then
      raise exception 'Insufficient stock. Refresh and choose another pharmacy.';
    end if;
  end loop;
  update public.supply_requests set pharmacy_id = p_pharmacy_id, status = 'assigned',
    assignment_version = assignment_version + 1, assigned_at = now(), assigned_by = auth.uid(), updated_at = now(),
    assignment_history = assignment_history || jsonb_build_array(jsonb_build_object(
      'pharmacy_id', p_pharmacy_id, 'previous_pharmacy_id', request.pharmacy_id,
      'version', request.assignment_version + 1, 'at', now(), 'by', auth.uid()))
    where id = p_id returning * into request;
  return to_jsonb(request);
end;
$$;

create or replace function public.advance_routed_demo_supply_request(
  p_id text, p_status text, p_pharmacy_id text, p_assignment_version integer
)
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
  if not found then raise exception 'Request not found'; end if;
  if request.pharmacy_id is null or request.pharmacy_id is distinct from p_pharmacy_id
    or request.assignment_version is distinct from p_assignment_version then
    raise exception 'Pharmacy assignment changed. Refresh your inbox.';
  end if;
  if request.status = p_status then return to_jsonb(request); end if;
  if not ((request.status = 'assigned' and p_status in ('accepted', 'declined'))
    or (request.status = 'accepted' and p_status = 'ready')
    or (request.status = 'ready' and p_status = 'collected')) then
    raise exception 'Status changed or Command Center assignment is required. Refresh your inbox.';
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
      updated_by = auth.uid(), revision = revision + 1 where pharmacy_id = request.pharmacy_id and is_simulated = true;
  end if;
  update public.supply_requests set status = p_status, updated_at = now() where id = p_id returning * into request;
  return to_jsonb(request);
end;
$$;

revoke all on function public.create_routed_demo_supply_request(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.assign_demo_supply_request(text, text, integer) from public, anon, authenticated;
revoke all on function public.advance_routed_demo_supply_request(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_routed_demo_supply_request(text, text, jsonb, text) to authenticated;
grant execute on function public.assign_demo_supply_request(text, text, integer) to authenticated;
grant execute on function public.advance_routed_demo_supply_request(text, text, text, integer) to authenticated;

commit;
