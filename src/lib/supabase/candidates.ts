import type { DiscoveryCandidate } from "@/lib/discovery/types";
import { getSupabaseAdmin } from "./admin";

const DUPLICATE_BLOCKING_STATUSES = new Set([
  "search_qualified",
  "needs_review",
  "hard_reject",
  "qualified",
  "contacted",
]);

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
    flags: [...candidate.flags, ...candidate.rejectReasons.map((reason) => `제외:${reason}`)],
    verification_status: candidate.verificationStatus,
    discovery_status: candidate.candidateStatus,
    last_seen_at: candidate.discoveredAt,
  }));

  // 1차 버전의 legacy status("discovered")는 새 품질 규칙으로 재평가해 갱신한다.
  // 이후 판정된 계정은 findExistingHandles에서 중복 차단된다.
  const { error } = await supabase.from("creator_candidates").upsert(rows, {
    onConflict: "normalized_handle",
  });
  if (error) console.warn("supabase_candidate_save_failed", error.message);
}
