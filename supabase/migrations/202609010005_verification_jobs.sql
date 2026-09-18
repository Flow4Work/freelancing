create table if not exists public.creator_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('beauty', 'food')),
  handles text[] not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.creator_verification_jobs enable row level security;

drop policy if exists "fixup_scout_select_verification_jobs" on public.creator_verification_jobs;
create policy "fixup_scout_select_verification_jobs"
on public.creator_verification_jobs
for select
to anon
using (true);

drop policy if exists "fixup_scout_insert_verification_jobs" on public.creator_verification_jobs;
create policy "fixup_scout_insert_verification_jobs"
on public.creator_verification_jobs
for insert
to anon
with check (true);

drop policy if exists "fixup_scout_update_verification_jobs" on public.creator_verification_jobs;
create policy "fixup_scout_update_verification_jobs"
on public.creator_verification_jobs
for update
to anon
using (true)
with check (true);

grant select, insert, update on public.creator_verification_jobs to anon;

create index if not exists creator_verification_jobs_status_idx
on public.creator_verification_jobs(status, created_at desc);
