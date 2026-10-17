begin;

alter table public.supply_requests add column if not exists hospital_received_at timestamptz;
alter table public.supply_requests add column if not exists hospital_received_by uuid references auth.users(id) on delete set null;
alter table public.supply_requests add column if not exists closed_at timestamptz;
alter table public.supply_requests drop constraint if exists supply_requests_status_check;
alter table public.supply_requests add constraint supply_requests_status_check
  check (status in ('awaiting_assignment', 'assigned', 'accepted', 'declined', 'ready', 'collected', 'closed'));

create or replace function public.confirm_demo_hospital_supply_receipt(p_id text, p_hospital_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  if p_hospital_id is null or p_hospital_id not in ('MMH-CEN', 'MMH-GEN', 'MMH-BIR') then
    raise exception 'Unknown demo hospital';
  end if;
  select * into request from public.supply_requests where id = p_id and is_simulated = true for update;
  if not found or request.hospital_id is distinct from p_hospital_id then
    raise exception 'This request does not belong to the selected hospital';
  end if;
  if request.status = 'closed' then return to_jsonb(request); end if;
  if request.status <> 'collected' then
    raise exception 'Pharmacy collection must be confirmed before hospital receipt. Refresh the request.';
  end if;
  update public.supply_requests set
    status = 'closed', hospital_received_at = now(), hospital_received_by = auth.uid(),
    closed_at = now(), updated_at = now()
    where id = p_id returning * into request;
  return to_jsonb(request);
end;
$$;

revoke all on function public.confirm_demo_hospital_supply_receipt(text, text) from public, anon, authenticated;
grant execute on function public.confirm_demo_hospital_supply_receipt(text, text) to authenticated;

commit;
