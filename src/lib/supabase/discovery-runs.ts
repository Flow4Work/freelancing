import type { SearchCategory } from "@/lib/discovery/types";
import { getSupabaseAdmin } from "./admin";

export type DiscoveryRunMetrics = {
  targetCount: number;
  queryCount: number;
  exaRawCount: number;
  tavilyRawCount: number;
  rawUrlCount: number;
  extractedResultCount: number;
  uniqueHandleCount: number;
  existingCandidateCount: number;
  hardRejectCount: number;
  manualExcludedCount: number;
  otherFilteredCount: number;
  newSavedCount: number;
  evidenceEnrichedCount: number;
  finalAddedCount: number;
  providerFailureCount: number;
};

export type StoredDiscoveryRun = DiscoveryRunMetrics & {
  id: string;
  category: SearchCategory;
  runNo: number;
  createdAt: string;
  completedAt: string | null;
};

export async function beginDiscoveryRun(category: SearchCategory) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 1;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error: readError } = await supabase
      .from("creator_discovery_runs")
      .select("run_no")
      .eq("category", category)
      .order("run_no", { ascending: false })
      .limit(1);

    if (readError) {
      console.warn("supabase_discovery_run_read_failed", readError.message);
      return 1;
    }

    const nextRun = Number(data?.[0]?.run_no ?? 0) + 1;
    const { error: insertError } = await supabase
      .from("creator_discovery_runs")
      .insert({ category, run_no: nextRun });

    if (!insertError) return nextRun;
    if (insertError.code !== "23505") {
      console.warn("supabase_discovery_run_insert_failed", insertError.message);
      return nextRun;
    }
  }

  return 1;
}

export async function completeDiscoveryRun(category: SearchCategory, runNo: number, metrics: DiscoveryRunMetrics) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase
    .from("creator_discovery_runs")
    .update({
      target_count: metrics.targetCount,
      query_count: metrics.queryCount,
      exa_raw_count: metrics.exaRawCount,
      tavily_raw_count: metrics.tavilyRawCount,
      raw_url_count: metrics.rawUrlCount,
      extracted_result_count: metrics.extractedResultCount,
      unique_handle_count: metrics.uniqueHandleCount,
      existing_candidate_count: metrics.existingCandidateCount,
      hard_reject_count: metrics.hardRejectCount,
      manual_excluded_count: metrics.manualExcludedCount,
      other_filtered_count: metrics.otherFilteredCount,
      new_saved_count: metrics.newSavedCount,
      evidence_enriched_count: metrics.evidenceEnrichedCount,
      final_added_count: metrics.finalAddedCount,
      provider_failure_count: metrics.providerFailureCount,
      completed_at: new Date().toISOString(),
    })
    .eq("category", category)
    .eq("run_no", runNo);

  if (error) console.warn("supabase_discovery_run_complete_failed", error.message);
}

export async function listRecentDiscoveryRuns(category: SearchCategory, limit = 8): Promise<StoredDiscoveryRun[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("creator_discovery_runs")
    .select("id, category, run_no, created_at, completed_at, target_count, query_count, exa_raw_count, tavily_raw_count, raw_url_count, extracted_result_count, unique_handle_count, existing_candidate_count, hard_reject_count, manual_excluded_count, other_filtered_count, new_saved_count, evidence_enriched_count, final_added_count, provider_failure_count")
    .eq("category", category)
    .order("run_no", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("supabase_discovery_history_read_failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    category,
    runNo: Number(row.run_no),
    createdAt: String(row.created_at),
    completedAt: nullableString(row.completed_at),
    targetCount: numberOrZero(row.target_count),
    queryCount: numberOrZero(row.query_count),
    exaRawCount: numberOrZero(row.exa_raw_count),
    tavilyRawCount: numberOrZero(row.tavily_raw_count),
    rawUrlCount: numberOrZero(row.raw_url_count),
    extractedResultCount: numberOrZero(row.extracted_result_count),
    uniqueHandleCount: numberOrZero(row.unique_handle_count),
    existingCandidateCount: numberOrZero(row.existing_candidate_count),
    hardRejectCount: numberOrZero(row.hard_reject_count),
    manualExcludedCount: numberOrZero(row.manual_excluded_count),
    otherFilteredCount: numberOrZero(row.other_filtered_count),
    newSavedCount: numberOrZero(row.new_saved_count),
    evidenceEnrichedCount: numberOrZero(row.evidence_enriched_count),
    finalAddedCount: numberOrZero(row.final_added_count),
    providerFailureCount: numberOrZero(row.provider_failure_count),
  }));
}

export async function findStoredReviewHandles(category: SearchCategory, handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !handles.length) return new Set<string>();

  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle")
    .eq("category", category)
    .eq("verification_status", "needs_instagram")
    .in("discovery_status", ["discovered", "needs_review"])
    .in("normalized_handle", handles);

  if (error) {
    console.warn("supabase_discovery_review_handles_failed", error.message);
    return new Set<string>();
  }
  return new Set((data ?? []).map((row) => String(row.normalized_handle)));
}

export async function countManualExcludedHandles(category: SearchCategory, handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !handles.length) return 0;

  const { count, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle", { count: "exact", head: true })
    .eq("category", category)
    .eq("verification_note", "수동 제외")
    .in("normalized_handle", handles);

  if (error) {
    console.warn("supabase_discovery_manual_excluded_count_failed", error.message);
    return 0;
  }
  return count ?? 0;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
