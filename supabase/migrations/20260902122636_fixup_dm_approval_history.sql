alter table public.creator_candidates
  add column if not exists dm_korean_text text;

create table if not exists public.creator_dm_contact_history (
  id uuid primary key default gen_random_uuid(),
  normalized_handle text not null,
  category text not null check (category in ('beauty', 'food')),
  japanese_text text not null,
  korean_text text not null,
  generated_at timestamptz not null,
  approved_at timestamptz not null default now(),
  opencode_status text not null default 'pending' check (opencode_status in ('pending', 'success', 'failed')),
  opencode_completed_at timestamptz,
  opencode_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists creator_dm_contact_history_category_created_idx
  on public.creator_dm_contact_history(category, created_at desc);
create index if not exists creator_dm_contact_history_handle_created_idx
  on public.creator_dm_contact_history(normalized_handle, created_at desc);

alter table public.creator_dm_contact_history enable row level security;

drop policy if exists "fixup_scout_select_dm_contact_history" on public.creator_dm_contact_history;
create policy "fixup_scout_select_dm_contact_history"
on public.creator_dm_contact_history
for select
to anon
using (true);

drop policy if exists "fixup_scout_insert_dm_contact_history" on public.creator_dm_contact_history;
create policy "fixup_scout_insert_dm_contact_history"
on public.creator_dm_contact_history
for insert
to anon
with check (true);

drop policy if exists "fixup_scout_update_dm_contact_history" on public.creator_dm_contact_history;
create policy "fixup_scout_update_dm_contact_history"
on public.creator_dm_contact_history
for update
to anon
using (true)
with check (true);

revoke update on table public.creator_dm_contact_history from anon;
grant select, insert on table public.creator_dm_contact_history to anon;
grant update (opencode_status, opencode_completed_at, opencode_error, sent_at)
  on table public.creator_dm_contact_history to anon;

comment on table public.creator_dm_contact_history is 'Append-only FixUp Scout approved DM attempts. Approved copy is immutable; only OpenCode/send status fields are updated.';
