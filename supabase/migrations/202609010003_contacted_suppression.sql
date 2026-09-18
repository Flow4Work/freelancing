drop policy if exists "fixup_scout_update_candidates" on public.creator_candidates;
create policy "fixup_scout_update_candidates"
on public.creator_candidates
for update
to anon
using (true)
with check (true);

create table if not exists public.creator_contacted_handles (
  normalized_handle text primary key,
  contacted_at timestamptz not null default now(),
  source text not null default 'manual'
);

alter table public.creator_contacted_handles enable row level security;

drop policy if exists "fixup_scout_select_contacted_handles" on public.creator_contacted_handles;
create policy "fixup_scout_select_contacted_handles"
on public.creator_contacted_handles
for select
to anon
using (true);

grant select on public.creator_contacted_handles to anon;

insert into public.creator_contacted_handles (normalized_handle, source) values
('asuka_imo','manual_dm_list'),
('kayo.cosme','manual_dm_list'),
('i.sayon','manual_dm_list'),
('keko_blog','manual_dm_list'),
('m_loves_kcosme','manual_dm_list'),
('soooonoo_','manual_dm_list'),
('mio_cosme','manual_dm_list'),
('yuiyuiinseoul','manual_dm_list'),
('hogege_cosme','manual_dm_list'),
('_ripink_2','manual_dm_list'),
('mimi_skincare_cosme','manual_dm_list'),
('habby_co','manual_dm_list'),
('misadongdong','manual_dm_list'),
('kapecchang','manual_dm_list'),
('kazoku_korea','manual_dm_list'),
('is9ream7','manual_dm_list'),
('natsuko06.09','manual_dm_list'),
('hiroe_maizaki1007','manual_dm_list'),
('maasa.05','manual_dm_list'),
('yuzu.tabi_','manual_dm_list'),
('sango_beauty35','manual_dm_list'),
('seouldegohan','manual_dm_list'),
('ajunma_tv','manual_dm_list')
on conflict (normalized_handle) do update
set contacted_at = excluded.contacted_at,
    source = excluded.source;

update public.creator_candidates
set discovery_status = 'contacted', updated_at = now()
where lower(normalized_handle) in (
'asuka_imo','kayo.cosme','i.sayon','keko_blog','m_loves_kcosme','soooonoo_','mio_cosme','yuiyuiinseoul','hogege_cosme','_ripink_2','mimi_skincare_cosme','habby_co','misadongdong','kapecchang','kazoku_korea','is9ream7','natsuko06.09','hiroe_maizaki1007','maasa.05','yuzu.tabi_','sango_beauty35','seouldegohan','ajunma_tv'
);
