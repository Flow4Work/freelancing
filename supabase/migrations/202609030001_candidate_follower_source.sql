alter table public.creator_candidates
  add column if not exists followers_source text;

update public.creator_candidates
set followers_source = 'instagram'
where followers is not null
  and followers_source is null;

alter table public.creator_candidates
  drop constraint if exists creator_candidates_followers_source_check;

alter table public.creator_candidates
  add constraint creator_candidates_followers_source_check
  check (followers_source is null or followers_source in ('search', 'instagram'));

comment on column public.creator_candidates.followers_source is 'Origin of creator_candidates.followers: search snippet reference or exact Instagram profile count.';
