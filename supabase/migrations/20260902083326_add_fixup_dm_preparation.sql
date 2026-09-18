alter table public.creator_candidates
  add column if not exists dm_personalization_source text,
  add column if not exists dm_personalization_basis text,
  add column if not exists dm_personalization_line text,
  add column if not exists dm_text text,
  add column if not exists dm_provider text,
  add column if not exists dm_model text,
  add column if not exists dm_generated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'creator_candidates_dm_provider_check'
      and conrelid = 'public.creator_candidates'::regclass
  ) then
    alter table public.creator_candidates
      add constraint creator_candidates_dm_provider_check
      check (dm_provider is null or dm_provider in ('groq', 'scaleway', 'fallback'));
  end if;
end
$$;
