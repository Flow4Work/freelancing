import type { CandidateStatus, DiscoveryCandidate, SearchCategory, SearchProviderName } from "@/lib/discovery/types";
import { getSupabaseAdmin } from "./admin";

const DUPLICATE_BLOCKING_STATUSES = new Set([
  "search_qualified",
  "needs_review",
  "hard_reject",
  "qualified",
  "contacted",
]);

const VISIBLE_STATUSES = ["search_qualified", "needs_review", "qualified", "contacted"];

export async function findExistingHandles(handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || handles.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, discovery_status")
    .in("normalized_handle", handles);

  if (error) {
    console.warn("supabase_duplicate_check_failed", error.message);
    return new Set<string>();
  }

  return new Set(
    (data ?? [])
      .filter((row) => DUPLICATE_BLOCKING_STATUSES.has(String(row.discovery_status)))
      .map((row) => String(row.normalized_handle)),
  );
}

export async function listCandidates(category: SearchCategory) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, profile_url, category, source_provider, evidence_url, evidence_text, evidence_kind, target_signals, korea_signals, flags, followers, reel_average, reel_median, reel_sample_size, verification_status, discovery_status, first_seen_at, last_seen_at")
    .eq("category", category)
    .in("discovery_status", VISIBLE_STATUSES)
    .order("first_seen_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.warn("supabase_candidate_list_failed", error.message);
    return [];
  }

  return (data ?? []).map((row): DiscoveryCandidate => {
    const rawStatus = String(row.discovery_status);
    const candidateStatus: CandidateStatus = rawStatus === "needs_review" ? "needs_review" : "search_qualified";
    const evidenceKind = row.evidence_kind === "content" ? "content" : "profile";

    return {
      handle: String(row.normalized_handle),
      profileUrl: String(row.profile_url),
      category,
      sourceProvider: normalizeProvider(row.source_provider),
      evidenceUrl: String(row.evidence_url ?? row.profile_url),
      evidenceText: String(row.evidence_text ?? ""),
      evidenceKind,
      candidateStatus,
      targetSignals: stringArray(row.target_signals),
      koreaSignals: stringArray(row.korea_signals),
      rejectReasons: [],
      flags: stringArray(row.flags).filter((flag) => !flag.startsWith("제외:")),
      followers: numberOrNull(row.followers),
      reelAverage: numberOrNull(row.reel_average),
      reelMedian: numberOrNull(row.reel_median),
      reelSampleSize: numberOrNull(row.reel_sample_size),
      verificationStatus: "needs_instagram",
      discoveredAt: String(row.first_seen_at ?? row.last_seen_at ?? new Date().toISOString()),
    };
  });
}

export async function saveCandidates(candidates: DiscoveryCandidate[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || candidates.length === 0) return;

  const rows = candidates.map((candidate) => ({
    handle: candidate.handle,
    normalized_handle: candidate.handle,
    profile_url: candidate.profileUrl,
    category: candidate.category,
    source_provider: candidate.sourceProvider,
    evidence_url: candidate.evidenceUrl,
    evidence_text: candidate.evidenceText,
    evidence_kind: candidate.evidenceKind,
    target_signals: candidate.targetSignals,
    korea_signals: candidate.koreaSignals,
    flags: [...candidate.flags, ...candidate.rejectReasons.map((reason) => `제외:${reason}`)],
    verification_status: candidate.verificationStatus,
    discovery_status: candidate.candidateStatus,
    last_seen_at: candidate.discoveredAt,
  }));

  // Legacy "discovered" rows are re-evaluated and updated. Once a row has a real
  // quality status, findExistingHandles blocks it from later discovery runs.
  const { error } = await supabase.from("creator_candidates").upsert(rows, {
    onConflict: "normalized_handle",
  });
  if (error) console.warn("supabase_candidate_save_failed", error.message);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeProvider(value: unknown): SearchProviderName {
  return value === "tavily" ? "tavily" : "exa";
}
