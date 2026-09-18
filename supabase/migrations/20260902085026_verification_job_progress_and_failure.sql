alter table public.creator_verification_jobs
  add column if not exists processed_handles text[] not null default '{}'::text[],
  add column if not exists failed_at timestamptz,
  add column if not exists failure_message text;

alter table public.creator_verification_jobs
  drop constraint if exists creator_verification_jobs_status_check;

alter table public.creator_verification_jobs
  add constraint creator_verification_jobs_status_check
  check (status in ('pending', 'completed', 'failed'));
