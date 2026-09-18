alter table public.creator_candidates
  add column if not exists duplicate_check_status text not null default 'not_checked',
  add column if not exists duplicate_check_message text,
  add column if not exists duplicate_checked_at timestamptz;

comment on column public.creator_candidates.duplicate_check_status is 'FixUp Apps Script duplicate result: not_checked, available, duplicate, protected, unknown.';
comment on column public.creator_candidates.duplicate_check_message is 'Exact or compact duplicate-check result text captured from the FixUp registration page.';
comment on column public.creator_candidates.duplicate_checked_at is 'Last time the FixUp duplicate page was checked for this Instagram handle.';
