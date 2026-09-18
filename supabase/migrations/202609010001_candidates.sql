create extension if not exists pgcrypto;

create table if not exists public.creator_candidates (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  normalized_handle text not null unique,
  profile_url text not null,
  category text not null check (category in ('beauty', 'food')),
  source_provider text,
  evidence_url text,
  evidence_text text,
  flags text[] not null default '{}',
  followers integer,
  reel_average integer,
  reel_median integer,
  reel_sample_size integer,
  verification_status text not null default 'needs_instagram',
  discovery_status text not null default 'discovered',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_candidates_category_idx on public.creator_candidates(category);
create index if not exists creator_candidates_verification_idx on public.creator_candidates(verification_status);

alter table public.creator_candidates enable row level security;

drop policy if exists "fixup_scout_select_candidates" on public.creator_candidates;
create policy "fixup_scout_select_candidates"
on public.creator_candidates
for select
to anon
using (true);

drop policy if exists "fixup_scout_insert_candidates" on public.creator_candidates;
create policy "fixup_scout_insert_candidates"
on public.creator_candidates
for insert
to anon
with check (true);

drop policy if exists "fixup_scout_update_candidates" on public.creator_candidates;
create policy "fixup_scout_update_candidates"
on public.creator_candidates
for update
to anon
using (true)
with check (true);

comment on table public.creator_candidates is 'FixUp Scout creator discovery history. Stores public creator discovery metadata for duplicate prevention.';
