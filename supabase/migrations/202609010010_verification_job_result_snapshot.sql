alter table public.creator_verification_jobs
  add column if not exists result_summary jsonb;

comment on column public.creator_verification_jobs.result_summary is
  'Completion-time snapshot of candidate destinations and exclusion reasons for the FixUp Scout automation history UI.';
