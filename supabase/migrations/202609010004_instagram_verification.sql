alter table public.creator_candidates
  add column if not exists bio text,
  add column if not exists reel_views jsonb not null default '[]'::jsonb,
  add column if not exists reel_checked_count integer,
  add column if not exists reel_total_considered integer,
  add column if not exists reel_metrics_status text not null default 'not_checked',
  add column if not exists last_activity_at timestamptz,
  add column if not exists verification_note text,
  add column if not exists is_private boolean,
  add column if not exists is_personal_creator boolean,
  add column if not exists japanese_target boolean,
  add column if not exists korea_connection boolean,
  add column if not exists category_relevant boolean,
  add column if not exists recent_activity boolean;

drop policy if exists "fixup_scout_update_candidates" on public.creator_candidates;
create policy "fixup_scout_update_candidates"
on public.creator_candidates
for update
to anon
using (true)
with check (true);

grant select, insert, update on public.creator_candidates to anon;

comment on column public.creator_candidates.reel_views is 'Latest Reel snapshots supplied by the local Instagram verifier. The app computes aggregates from these raw values.';
comment on column public.creator_candidates.reel_metrics_status is 'not_checked, ready (>=5 valid view samples), or insufficient.';
