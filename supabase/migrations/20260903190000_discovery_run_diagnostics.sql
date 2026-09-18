alter table public.creator_discovery_runs
  add column if not exists target_count integer,
  add column if not exists query_count integer,
  add column if not exists exa_raw_count integer,
  add column if not exists tavily_raw_count integer,
  add column if not exists raw_url_count integer,
  add column if not exists extracted_result_count integer,
  add column if not exists unique_handle_count integer,
  add column if not exists existing_candidate_count integer,
  add column if not exists hard_reject_count integer,
  add column if not exists manual_excluded_count integer,
  add column if not exists other_filtered_count integer,
  add column if not exists new_saved_count integer,
  add column if not exists evidence_enriched_count integer,
  add column if not exists final_added_count integer,
  add column if not exists provider_failure_count integer,
  add column if not exists completed_at timestamptz;

comment on column public.creator_discovery_runs.extracted_result_count is 'Search result rows from which an Instagram handle was extracted before handle deduplication.';
comment on column public.creator_discovery_runs.unique_handle_count is 'Unique Instagram handles after extraction/deduplication.';
comment on column public.creator_discovery_runs.other_filtered_count is 'Raw search rows filtered before handle grouping because no valid Instagram candidate could be extracted.';
