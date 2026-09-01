alter table public.creator_verification_jobs
  add column if not exists job_kind text not null default 'instagram';

alter table public.creator_verification_jobs
  drop constraint if exists creator_verification_jobs_job_kind_check;

alter table public.creator_verification_jobs
  add constraint creator_verification_jobs_job_kind_check
  check (job_kind in ('duplicate', 'instagram'));

create index if not exists creator_verification_jobs_kind_status_idx
on public.creator_verification_jobs(job_kind, status, created_at desc);
