begin;

create table if not exists public.command_operators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.command_operators enable row level security;
revoke all on public.command_operators from anon, authenticated;
grant select on public.command_operators to authenticated;
drop policy if exists "Read own command access" on public.command_operators;
create policy "Read own command access" on public.command_operators for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.emergency_requests (
  id text primary key,
  owner_id uuid not null references auth.users(id),
  revision bigint not null check (revision > 0),
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'dispatched', 'assigned', 'closed', 'cancelled')),
  operation_version integer not null default 1,
  ambulance_id text check (ambulance_id in ('AMB-01', 'AMB-02')),
  ambulance_dispatched_at timestamptz,
  hospital_id text references public.hospitals(hosid),
  bed_type text check (bed_type in ('general', 'icu')),
  bed_reserved boolean not null default false,
  hospital_assigned_at timestamptz,
  cancellation_requested boolean not null default false,
  patient_received_at timestamptz,
  patient_received_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists emergency_requests_owner_idx on public.emergency_requests(owner_id);
create index if not exists emergency_requests_hospital_created_idx on public.emergency_requests(hospital_id, created_at desc);
create index if not exists emergency_requests_status_created_idx on public.emergency_requests(status, created_at desc);
create unique index if not exists emergency_active_ambulance_key on public.emergency_requests(ambulance_id)
  where status not in ('closed', 'cancelled');
alter table public.emergency_requests enable row level security;
revoke all on public.emergency_requests from anon, authenticated;
grant select on public.emergency_requests to authenticated;
drop policy if exists "Read authorized emergencies" on public.emergency_requests;
create policy "Read authorized emergencies" on public.emergency_requests for select to authenticated using (
  owner_id = (select auth.uid())
  or exists (select 1 from public.command_operators staff where staff.user_id = (select auth.uid()))
  or exists (select 1 from public.hospital_staff staff where staff.user_id = (select auth.uid()) and staff.hosid = hospital_id)
);

create table if not exists public.emergency_events (
  id bigint generated always as identity primary key,
  request_id text not null references public.emergency_requests(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists emergency_events_request_idx on public.emergency_events(request_id, created_at);
alter table public.emergency_events enable row level security;
revoke all on public.emergency_events from anon, authenticated;
grant select on public.emergency_events to authenticated;
drop policy if exists "Read authorized emergency events" on public.emergency_events;
create policy "Read authorized emergency events" on public.emergency_events for select to authenticated
  using (exists (select 1 from public.emergency_requests request where request.id = request_id));

create or replace function public.submit_emergency_request(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.emergency_requests%rowtype;
  request_id text := p_payload ->> 'id';
  request_revision bigint;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 50000
    or request_id is null or request_id !~ '^[a-z0-9-]{10,100}$'
    or coalesce(p_payload ->> 'revision', '') !~ '^[1-9][0-9]{0,8}$'
    or coalesce(p_payload ->> 'mode', '') not in ('self', 'other')
    or coalesce(p_payload ->> 'phase', '') not in ('identify', 'questions', 'ready', 'cancelled', 'closed')
    or jsonb_typeof(p_payload -> 'answers') is distinct from 'object'
    or jsonb_typeof(p_payload -> 'missedQuestions') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'conditionUpdates') is distinct from 'array'
    or ((p_payload ->> 'medmeshId') is not null and (p_payload ->> 'medmeshId') !~ '^[A-Z]{6}$') then
    raise exception 'Invalid emergency request';
  end if;
  if exists (select 1 from jsonb_each(p_payload -> 'answers') answer where jsonb_typeof(answer.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(p_payload -> 'missedQuestions') item where jsonb_typeof(item) <> 'string') then
    raise exception 'Invalid answers';
  end if;
  if p_payload -> 'coordinates' is not null and p_payload -> 'coordinates' <> 'null'::jsonb then
    if jsonb_typeof(p_payload -> 'coordinates') is distinct from 'object'
      or jsonb_typeof(p_payload #> '{coordinates,latitude}') is distinct from 'number'
      or jsonb_typeof(p_payload #> '{coordinates,longitude}') is distinct from 'number' then
      raise exception 'Invalid coordinates';
    end if;
    if abs((p_payload #>> '{coordinates,latitude}')::numeric) > 90
      or abs((p_payload #>> '{coordinates,longitude}')::numeric) > 180 then raise exception 'Invalid coordinates'; end if;
  end if;
  request_revision := (p_payload ->> 'revision')::bigint;
  select * into request from public.emergency_requests where id = request_id for update;
  if found then
    if request.owner_id <> auth.uid() then raise exception 'Request belongs to another account' using errcode = '42501'; end if;
    if request_revision <= request.revision or request.status in ('closed', 'cancelled') then return to_jsonb(request); end if;
    update public.emergency_requests set payload = p_payload, revision = request_revision, updated_at = now(), operation_version = operation_version + 1,
      cancellation_requested = cancellation_requested or (p_payload ->> 'phase' = 'cancelled'),
      status = case when p_payload ->> 'phase' = 'cancelled' and ambulance_id is null and hospital_id is null then 'cancelled' else status end
      where id = request_id returning * into request;
  else
    insert into public.emergency_requests (id, owner_id, revision, payload, status, cancellation_requested)
      values (request_id, auth.uid(), request_revision, p_payload,
        case when p_payload ->> 'phase' = 'cancelled' then 'cancelled' else 'received' end,
        p_payload ->> 'phase' = 'cancelled') returning * into request;
  end if;
  insert into public.emergency_events (request_id, event_type, details, actor_id)
    values (request_id, 'member_update', jsonb_build_object('revision', request_revision), auth.uid());
  return to_jsonb(request);
end;
$$;

create or replace function public.operate_demo_emergency(p_id text, p_action text, p_details jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.emergency_requests%rowtype;
  capacity public.hospital_status%rowtype;
  target text := p_details ->> 'hospital_id';
  chosen_bed text := p_details ->> 'bed_type';
  unit text := p_details ->> 'ambulance_id';
  operator_access boolean;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('dispatch', 'assign', 'receive', 'cancel') then raise exception 'Unknown action'; end if;
  select exists(select 1 from public.command_operators where user_id = auth.uid()) into operator_access;
  select * into request from public.emergency_requests where id = p_id for update;
  if not found then raise exception 'SOS request not found'; end if;
  if not operator_access and not (p_action = 'receive' and exists (
    select 1 from public.hospital_staff where user_id = auth.uid() and hosid = request.hospital_id
  )) then raise exception 'SOS staff access is required' using errcode = '42501'; end if;
  if p_action = 'receive' and request.status = 'closed' then return to_jsonb(request); end if;
  if request.status in ('closed', 'cancelled') then raise exception 'This SOS is already closed'; end if;
  if coalesce(p_details ->> 'version', '') <> request.operation_version::text then
    raise exception 'Request changed. Refresh before acting.';
  end if;
  if request.cancellation_requested and p_action <> 'cancel' then raise exception 'Resolve the member cancellation first'; end if;

  if p_action = 'dispatch' then
    if unit is null or unit not in ('AMB-01', 'AMB-02') then raise exception 'Choose a demo ambulance'; end if;
    if request.ambulance_id is not null then raise exception 'Ambulance dispatch is already recorded'; end if;
    if exists (select 1 from public.emergency_requests where ambulance_id = unit and status not in ('closed', 'cancelled')) then
      raise exception 'Ambulance is busy. Refresh and choose another.';
    end if;
    update public.emergency_requests set ambulance_id = unit, ambulance_dispatched_at = now(),
      status = case when hospital_id is null then 'dispatched' else 'assigned' end where id = p_id;
  elsif p_action = 'assign' then
    if request.ambulance_id is null then raise exception 'Record demo ambulance dispatch before hospital assignment'; end if;
    if target is null or target not in ('MMH-CEN', 'MMH-GEN', 'MMH-BIR') or chosen_bed is null or chosen_bed not in ('general', 'icu') then
      raise exception 'Choose a hospital and bed type';
    end if;
    if request.hospital_id is not null then raise exception 'Hospital already assigned'; end if;
    select * into capacity from public.hospital_status where hosid = target and is_simulated = true for update;
    if not found or capacity.is_open is distinct from true or capacity.free_beds is null
      or capacity.free_icu_beds is null or capacity.free_beds < 1 then raise exception 'Hospital capacity unavailable'; end if;
    if (chosen_bed = 'icu' and capacity.free_icu_beds < 1)
      or (chosen_bed = 'general' and capacity.free_beds - capacity.free_icu_beds < 1) then raise exception 'No available bed of this type'; end if;
    update public.hospital_status set free_beds = free_beds - 1,
      free_icu_beds = free_icu_beds - case when chosen_bed = 'icu' then 1 else 0 end,
      reported_at = now() where hosid = target and is_simulated = true;
    update public.emergency_requests set hospital_id = target, bed_type = chosen_bed,
      bed_reserved = true, hospital_assigned_at = now(), status = 'assigned' where id = p_id;
  elsif p_action = 'receive' then
    if request.hospital_id is null or request.status <> 'assigned' then raise exception 'Hospital assignment is required'; end if;
    if p_details ->> 'hospital_id' is distinct from request.hospital_id then raise exception 'Selected hospital does not match this SOS'; end if;
    update public.emergency_requests set status = 'closed', patient_received_at = now(),
      patient_received_by = auth.uid(), closed_at = now() where id = p_id;
    -- The patient now occupies this bed. Arrival does not free it.
  else
    if not request.cancellation_requested then raise exception 'No member cancellation is pending'; end if;
    if request.bed_reserved then
      update public.hospital_status set free_beds = free_beds + 1,
        free_icu_beds = free_icu_beds + case when request.bed_type = 'icu' then 1 else 0 end,
        reported_at = now() where hosid = request.hospital_id and is_simulated = true;
    end if;
    update public.emergency_requests set status = 'cancelled', bed_reserved = false,
      closed_at = now() where id = p_id;
  end if;
  update public.emergency_requests set operation_version = operation_version + 1, updated_at = now()
    where id = p_id returning * into request;
  insert into public.emergency_events (request_id, event_type, details, actor_id)
    values (p_id, 'demo_' || p_action, p_details, auth.uid());
  return to_jsonb(request);
end;
$$;

revoke all on function public.submit_emergency_request(jsonb) from public, anon, authenticated;
revoke all on function public.operate_demo_emergency(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_emergency_request(jsonb) to authenticated;
grant execute on function public.operate_demo_emergency(text, text, jsonb) to authenticated;

commit;
