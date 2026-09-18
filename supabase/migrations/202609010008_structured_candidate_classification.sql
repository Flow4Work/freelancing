alter table public.creator_candidates
  add column if not exists account_availability text not null default 'unknown',
  add column if not exists account_type text not null default 'unknown',
  add column if not exists korea_affinity text not null default 'unknown',
  add column if not exists content_fit text not null default 'other',
  add column if not exists eligibility text not null default 'unknown',
  add column if not exists activity text not null default 'unknown';

alter table public.creator_candidates
  add constraint creator_candidates_account_availability_check check (account_availability in ('active','unavailable','unknown')),
  add constraint creator_candidates_account_type_check check (account_type in ('creator','business','unknown')),
  add constraint creator_candidates_korea_affinity_check check (korea_affinity in ('strong','yes','none','unknown')),
  add constraint creator_candidates_content_fit_check check (content_fit in ('beauty','food','korea_travel','lifestyle','other')),
  add constraint creator_candidates_eligibility_check check (eligibility in ('possible','fail','unknown')),
  add constraint creator_candidates_activity_check check (activity in ('active','unknown'));

update public.creator_candidates
set
  account_availability = case
    when verification_note ilike '현재 존재하지 않는 계정%' then 'unavailable'
    when verified_at is not null then 'active'
    else 'unknown'
  end,
  account_type = case
    when is_personal_creator is true then 'creator'
    when is_personal_creator is false then 'business'
    when coalesce(array_to_string(flags, ' '), '') ~ '제외:(사업체형 ID|의사/병원장 계정|공식/사업체 계정|미디어/정보 계정)' then 'business'
    when discovery_status = 'search_qualified'
      and evidence_kind = 'profile'
      and not ('개인 Creator 근거 추가확인' = any(coalesce(flags, array[]::text[]))) then 'creator'
    else 'unknown'
  end,
  korea_affinity = case
    when korea_connection is false then 'none'
    when korea_connection is true and (
      '일한 배경' = any(coalesce(target_signals, array[]::text[]))
      or '한국 거주' = any(coalesce(korea_signals, array[]::text[]))
    ) then 'strong'
    when korea_connection is true then 'yes'
    when '일한 배경' = any(coalesce(target_signals, array[]::text[]))
      or '한국 거주' = any(coalesce(korea_signals, array[]::text[])) then 'strong'
    when cardinality(coalesce(korea_signals, array[]::text[])) > 0 then 'yes'
    else 'unknown'
  end,
  content_fit = case
    when category_relevant is true then category
    when discovery_status = 'search_qualified' then category
    else 'other'
  end,
  activity = case when recent_activity is true then 'active' else 'unknown' end;

update public.creator_candidates
set eligibility = case
  when account_availability = 'unavailable'
    or account_type = 'business'
    or korea_affinity = 'none'
    or discovery_status in ('hard_reject','private') then 'fail'
  when account_type = 'creator'
    and korea_affinity in ('strong','yes')
    and content_fit = category then 'possible'
  else 'unknown'
end;

update public.creator_candidates
set discovery_status = case
  when account_availability = 'unavailable'
    or account_type = 'business'
    or korea_affinity = 'none'
    or eligibility = 'fail' then 'hard_reject'
  when account_availability = 'active'
    and account_type = 'creator'
    and korea_affinity in ('strong','yes')
    and content_fit = category
    and eligibility = 'possible' then 'search_qualified'
  else 'needs_review'
end,
verification_status = case
  when account_availability = 'unavailable'
    or account_type = 'business'
    or korea_affinity = 'none'
    or eligibility = 'fail' then 'hard_reject'
  else verification_status
end
where duplicate_check_status in ('not_checked','unknown')
  and verification_status in ('needs_instagram','hard_reject')
  and discovery_status <> 'contacted';
