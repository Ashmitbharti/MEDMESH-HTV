begin;

-- Demo-only access: authenticated app sessions can edit simulated status for these three hospitals.
-- Real hospital status, reference data and staff membership remain protected by their existing policies.
create or replace function public.update_demo_hospital_status(
  p_hosid text,
  p_free_beds integer,
  p_free_icu_beds integer,
  p_er_wait_minutes integer,
  p_is_open boolean,
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
  if p_hosid is null or p_hosid not in ('MMH-CEN', 'MMH-GEN', 'MMH-BIR') then
    raise exception 'Unknown demo hospital';
  end if;
  if p_free_beds is null or p_free_beds not between 0 and 10000
    or p_free_icu_beds is null or p_free_icu_beds not between 0 and p_free_beds
    or p_er_wait_minutes is null or p_er_wait_minutes not between 0 and 10080
    or p_is_open is null or p_services is null or p_reported_at is null then
    raise exception 'Invalid demo availability';
  end if;
  select services into allowed_services from public.hospitals where hosid = p_hosid;
  if not found then
    raise exception 'Hospital seed data is missing';
  end if;
  if not (p_services <@ allowed_services) or array_position(p_services, null) is not null then
    raise exception 'Choose services listed for this hospital';
  end if;

  insert into public.hospital_status (
    hosid, is_simulated, free_beds, free_icu_beds, er_wait_minutes,
    is_open, available_services, reported_at
  ) values (
    p_hosid, true, p_free_beds, p_free_icu_beds, p_er_wait_minutes,
    p_is_open, p_services, p_reported_at
  ) on conflict (hosid, is_simulated) do update set
    free_beds = excluded.free_beds,
    free_icu_beds = excluded.free_icu_beds,
    er_wait_minutes = excluded.er_wait_minutes,
    is_open = excluded.is_open,
    available_services = excluded.available_services,
    reported_at = excluded.reported_at
  returning received_at into received;
  return received;
end;
$$;

revoke all on function public.update_demo_hospital_status(text, integer, integer, integer, boolean, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.update_demo_hospital_status(text, integer, integer, integer, boolean, text[], timestamptz) to authenticated;

commit;
