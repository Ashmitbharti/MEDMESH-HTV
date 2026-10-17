begin;
alter table public.hospitals add column if not exists entry_code text
  check (entry_code ~ '^[0-9]{6}$');
create unique index if not exists hospitals_entry_code_key on public.hospitals(entry_code);
update public.hospitals set entry_code = '100001' where hosid = 'MMH-CEN';
update public.hospitals set entry_code = '100002' where hosid = 'MMH-GEN';
update public.hospitals set entry_code = '100003' where hosid = 'MMH-BIR';
commit;
