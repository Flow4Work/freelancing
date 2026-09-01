import type { DuplicateCheckStatus, ReelSnapshot, SearchCategory } from "@/lib/discovery/types";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { decideVerification } from "@/lib/verification/decision";
import { computeReelMetrics } from "@/lib/verification/metrics";
import { getSupabaseAdmin } from "./admin";

export type InstagramVerificationResult = {
  handle: string;
  duplicateStatus: Exclude<DuplicateCheckStatus, "not_checked">;
  duplicateMessage: string | null;
  exists: boolean | null;
  isPrivate: boolean | null;
  isPersonalCreator: boolean | null;
  bio: string | null;
  followers: number | null;
  recentActivity: boolean | null;
  lastActivityAt: string | null;
  japaneseTarget: boolean | null;
  koreaConnection: boolean | null;
  categoryRelevant: boolean | null;
  reels: ReelSnapshot[];
  note: string | null;
};

export async function applyInstagramVerificationResults(category: SearchCategory, results: InstagramVerificationResult[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const normalizedResults = results
    .map((result) => ({ ...result, handle: normalizeHandle(result.handle) }))
    .filter((result) => isValidHandle(result.handle));

  if (!normalizedResults.length) return { updated: 0, ignored: results.length };

  const handles = [...new Set(normalizedResults.map((result) => result.handle))];
  const [{ data: candidates, error: candidateError }, { data: contacted, error: contactedError }] = await Promise.all([
    supabase.from("creator_candidates").select("normalized_handle").eq("category", category).in("normalized_handle", handles),
    supabase.from("creator_contacted_handles").select("normalized_handle").in("normalized_handle", handles),
  ]);

  if (candidateError) throw new Error(`후보 확인 실패: ${candidateError.message}`);
  if (contactedError) throw new Error(`컨택 이력 확인 실패: ${contactedError.message}`);

  const allowed = new Set((candidates ?? []).map((row) => String(row.normalized_handle)));
  const blocked = new Set((contacted ?? []).map((row) => String(row.normalized_handle)));
  let updated = 0;

  for (const result of normalizedResults) {
    if (!allowed.has(result.handle) || blocked.has(result.handle)) continue;

    const metrics = computeReelMetrics(result.reels);
    const decision = decideVerification({
      category,
      duplicateStatus: result.duplicateStatus,
      exists: result.exists,
      isPrivate: result.isPrivate,
      isPersonalCreator: result.isPersonalCreator,
      followers: result.followers,
      recentActivity: result.recentActivity,
      japaneseTarget: result.japaneseTarget,
      koreaConnection: result.koreaConnection,
      categoryRelevant: result.categoryRelevant,
      reelMetrics: metrics,
    });
    const now = new Date().toISOString();
    const compactNote = result.note ? `${decision.reason} · ${result.note}`.slice(0, 500) : decision.reason;

    // FixUp 중복 페이지가 먼저다. 중복/보호/확인불가라면 Instagram 값은 건드리지 않는다.
    if (result.duplicateStatus !== "available") {
      const { error } = await supabase
        .from("creator_candidates")
        .update({
          duplicate_check_status: result.duplicateStatus,
          duplicate_check_message: result.duplicateMessage,
          duplicate_checked_at: now,
          verification_note: compactNote,
          verification_status: decision.verificationStatus,
          discovery_status: decision.discoveryStatus,
          updated_at: now,
        })
        .eq("normalized_handle", result.handle)
        .eq("category", category);

      if (error) throw new Error(`@${result.handle} 중복 결과 저장 실패: ${error.message}`);
      updated += 1;
      continue;
    }

    const { error } = await supabase
      .from("creator_candidates")
      .update({
        duplicate_check_status: result.duplicateStatus,
        duplicate_check_message: result.duplicateMessage,
        duplicate_checked_at: now,
        account_availability: result.exists === true ? "active" : result.exists === false ? "unavailable" : "unknown",
        account_type: result.isPersonalCreator === true ? "creator" : result.isPersonalCreator === false ? "business" : "unknown",
        korea_affinity: result.koreaConnection === true ? "yes" : result.koreaConnection === false ? "none" : "unknown",
        content_fit: result.categoryRelevant === true ? category : "other",
        eligibility: decision.discoveryStatus === "qualified" ? "possible" : decision.discoveryStatus === "hard_reject" || decision.discoveryStatus === "private" ? "fail" : "unknown",
        activity: result.recentActivity === true ? "active" : "unknown",
        bio: result.bio,
        followers: result.followers,
        reel_average: metrics.average,
        reel_median: metrics.median,
        reel_sample_size: metrics.sampleSize,
        reel_checked_count: metrics.checkedCount,
        reel_total_considered: metrics.totalConsidered,
        reel_metrics_status: metrics.status,
        reel_views: metrics.snapshots,
        last_activity_at: normalizeIso(result.lastActivityAt),
        verification_note: compactNote,
        is_private: result.isPrivate,
        is_personal_creator: result.isPersonalCreator,
        japanese_target: result.japaneseTarget,
        korea_connection: result.koreaConnection,
        category_relevant: result.categoryRelevant,
        recent_activity: result.recentActivity,
        verification_status: decision.verificationStatus,
        discovery_status: decision.discoveryStatus,
        verified_at: now,
        updated_at: now,
      })
      .eq("normalized_handle", result.handle)
      .eq("category", category);

    if (error) throw new Error(`@${result.handle} 검증 저장 실패: ${error.message}`);
    updated += 1;
  }

  return { updated, ignored: results.length - updated };
}

function normalizeIso(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
