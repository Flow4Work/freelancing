alter table public.creator_candidates
  add column if not exists evidence_kind text,
  add column if not exists target_signals text[] not null default '{}',
  add column if not exists korea_signals text[] not null default '{}';

create table if not exists public.creator_discovery_runs (
  id bigint generated always as identity primary key,
  category text not null check (category in ('beauty', 'food')),
  run_no integer not null,
  created_at timestamptz not null default now(),
  unique (category, run_no)
);

alter table public.creator_discovery_runs enable row level security;

drop policy if exists "fixup_scout_select_discovery_runs" on public.creator_discovery_runs;
create policy "fixup_scout_select_discovery_runs"
on public.creator_discovery_runs
for select
to anon
using (true);

drop policy if exists "fixup_scout_insert_discovery_runs" on public.creator_discovery_runs;
create policy "fixup_scout_insert_discovery_runs"
on public.creator_discovery_runs
for insert
to anon
with check (true);

comment on table public.creator_discovery_runs is 'FixUp Scout search-run sequence used to rotate query expansions across repeated local discovery runs.';
