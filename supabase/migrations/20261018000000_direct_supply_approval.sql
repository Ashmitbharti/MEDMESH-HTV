begin;

-- Reuse the existing order and stock tables. Approval reserves stock once and
-- routes the order to the requesting hospital without another Command Center step.
create or replace function public.approve_demo_supply_to_hospital(
  p_id text, p_pharmacy_id text, p_assignment_version integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request public.supply_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'An app session is required' using errcode = '42501'; end if;
  select * into request from public.supply_requests where id = p_id and is_simulated = true for update;
  if not found or request.pharmacy_id is distinct from p_pharmacy_id
    or request.assignment_version is distinct from p_assignment_version then
    raise exception 'Assignment changed. Refresh the request.';
  end if;
  if request.status = 'closed' then return to_jsonb(request); end if;
  -- Existing RPC validates assignment, availability and quantities under a row lock.
  perform public.advance_routed_demo_supply_request(p_id, 'accepted', p_pharmacy_id, p_assignment_version);
  update public.supply_requests set status = 'closed', closed_at = now(), updated_at = now()
    where id = p_id returning * into request;
  -- hospital_received_at stays empty: approval is not proof of physical delivery.
  return to_jsonb(request);
end;
$$;

revoke all on function public.approve_demo_supply_to_hospital(text, text, integer) from public, anon, authenticated;
grant execute on function public.approve_demo_supply_to_hospital(text, text, integer) to authenticated;

commit;
