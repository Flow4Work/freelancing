alter table public.creator_dm_contact_history
  add column if not exists approval_status text not null default 'approved';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'creator_dm_contact_history_approval_status_check'
      and conrelid = 'public.creator_dm_contact_history'::regclass
  ) then
    alter table public.creator_dm_contact_history
      add constraint creator_dm_contact_history_approval_status_check
      check (approval_status = 'approved');
  end if;
end
$$;

revoke update (approval_status) on table public.creator_dm_contact_history from anon;
