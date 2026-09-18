update public.creator_candidates
set account_type = 'creator'
where account_type = 'unknown'
  and evidence_kind = 'profile'
  and not ('개인 Creator 근거 추가확인' = any(coalesce(flags, array[]::text[])))
  and coalesce(array_to_string(flags, ' '), '') !~ '제외:(사업체형 ID|의사/병원장 계정|공식/사업체 계정|미디어/정보 계정)'
  and discovery_status not in ('hard_reject','private','contacted');

update public.creator_candidates
set content_fit = case
  when category = 'beauty' and evidence_text ~* '(美容|美容医療|コスメ|化粧品|スキンケア|美肌|肌管理|皮膚科|クリニック|薬局|オリーブヤング|購入品|アンプル|セラム|トナー|リジュラン|ポテンツァ|ピコ|リフト|フィラー|K-?Beauty)' then 'beauty'
  when category = 'food' and evidence_text ~* '(グルメ|食べ歩き|カフェ|レストラン|韓国料理|ごはん|食堂|居酒屋|焼肉|ケジャン)' then 'food'
  when evidence_text ~* '(美容|美容医療|コスメ|化粧品|スキンケア|美肌|肌管理|皮膚科|クリニック|薬局|オリーブヤング|K-?Beauty)' then 'beauty'
  when evidence_text ~* '(グルメ|食べ歩き|カフェ|レストラン|韓国料理|ごはん|食堂|居酒屋|焼肉|ケジャン)' then 'food'
  when evidence_text ~* '(韓国旅行|渡韓|ソウル旅行|釜山旅行|韓国ひとり旅|旅韓|韓国観光)' then 'korea_travel'
  when evidence_text ~* '(暮らし|ライフスタイル|日常|ファッション|コーデ|育児|ママ|夫婦|VLOG)' then 'lifestyle'
  else content_fit
end
where content_fit = 'other';

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
