create table if not exists public.creator_planned_visits (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.creator_candidates(id) on delete set null,
  instagram_handle text not null,
  planned_for text not null check (
    planned_for ~ '^\d{4}-\d{2}$'
    or planned_for ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  memo text not null default '',
  reminder_at date not null,
  reminder_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_planned_visits_reminder_idx
  on public.creator_planned_visits(reminder_at, reminder_seen_at);
create index if not exists creator_planned_visits_handle_idx
  on public.creator_planned_visits(instagram_handle);

alter table public.creator_planned_visits enable row level security;
drop policy if exists "fixup_scout_select_planned_visits" on public.creator_planned_visits;
create policy "fixup_scout_select_planned_visits"
on public.creator_planned_visits for select to anon using (true);

drop policy if exists "fixup_scout_insert_planned_visits" on public.creator_planned_visits;
create policy "fixup_scout_insert_planned_visits"
on public.creator_planned_visits for insert to anon with check (true);

drop policy if exists "fixup_scout_update_planned_visits" on public.creator_planned_visits;
create policy "fixup_scout_update_planned_visits"
on public.creator_planned_visits for update to anon using (true) with check (true);

drop policy if exists "fixup_scout_delete_planned_visits" on public.creator_planned_visits;
create policy "fixup_scout_delete_planned_visits"
on public.creator_planned_visits for delete to anon using (true);

comment on table public.creator_planned_visits is
  'FixUp Scout manually managed creator Korea-visit plans and reminder state.';
