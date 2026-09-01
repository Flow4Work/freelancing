import type { DiscoveryCandidate } from "@/lib/discovery/types";
import { getSupabaseAdmin } from "./admin";

export async function findExistingHandles(handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || handles.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle")
    .in("normalized_handle", handles);

  if (error) {
    console.warn("supabase_duplicate_check_failed", error.message);
    return new Set<string>();
  }
  return new Set((data ?? []).map((row) => String(row.normalized_handle)));
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
    first_seen_at: candidate.discoveredAt,
    last_seen_at: candidate.discoveredAt,
  }));

  const { error } = await supabase.from("creator_candidates").upsert(rows, {
    onConflict: "normalized_handle",
    ignoreDuplicates: true,
  });
  if (error) console.warn("supabase_candidate_save_failed", error.message);
}
