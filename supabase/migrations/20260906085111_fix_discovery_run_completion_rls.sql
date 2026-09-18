revoke update on table public.creator_discovery_runs from anon;

grant update (
  target_count,
  query_count,
  exa_raw_count,
  tavily_raw_count,
  raw_url_count,
  extracted_result_count,
  unique_handle_count,
  existing_candidate_count,
  hard_reject_count,
  manual_excluded_count,
  other_filtered_count,
  new_saved_count,
  evidence_enriched_count,
  final_added_count,
  provider_failure_count,
  completed_at
) on public.creator_discovery_runs to anon;

drop policy if exists "fixup_scout_complete_discovery_runs" on public.creator_discovery_runs;
create policy "fixup_scout_complete_discovery_runs"
on public.creator_discovery_runs
for update
to anon
using (completed_at is null)
with check (
  completed_at is not null
  and completed_at >= created_at
  and target_count is not null and target_count >= 0
  and query_count is not null and query_count >= 0
  and exa_raw_count is not null and exa_raw_count >= 0
  and tavily_raw_count is not null and tavily_raw_count >= 0
  and raw_url_count is not null and raw_url_count >= 0
  and extracted_result_count is not null and extracted_result_count >= 0
  and unique_handle_count is not null and unique_handle_count >= 0
  and existing_candidate_count is not null and existing_candidate_count >= 0
  and hard_reject_count is not null and hard_reject_count >= 0
  and manual_excluded_count is not null and manual_excluded_count >= 0
  and other_filtered_count is not null and other_filtered_count >= 0
  and new_saved_count is not null and new_saved_count >= 0
  and evidence_enriched_count is not null and evidence_enriched_count >= 0
  and final_added_count is not null and final_added_count >= 0
  and provider_failure_count is not null and provider_failure_count >= 0
);
