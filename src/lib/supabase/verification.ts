import type { ReelSnapshot, SearchCategory } from "@/lib/discovery/types";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { computeReelMetrics } from "@/lib/verification/metrics";
import { getSupabaseAdmin } from "./admin";

export type InstagramVerificationResult = {
  handle: string;
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
    const decision = decideVerification(result);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("creator_candidates")
      .update({
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
        verification_note: result.note,
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

function decideVerification(result: InstagramVerificationResult) {
  if (result.exists === false) return { discoveryStatus: "hard_reject", verificationStatus: "rejected" } as const;
  if (result.isPrivate === true) return { discoveryStatus: "private", verificationStatus: "private" } as const;
  if (result.isPersonalCreator === false) return { discoveryStatus: "hard_reject", verificationStatus: "rejected" } as const;

  const coreUnknown = result.exists === null
    || result.isPrivate === null
    || result.isPersonalCreator === null
    || result.japaneseTarget === null
    || result.koreaConnection === null
    || result.categoryRelevant === null
    || result.recentActivity === null
    || result.followers === null;

  const qualitativePass = result.exists === true
    && result.isPrivate === false
    && result.isPersonalCreator === true
    && result.japaneseTarget === true
    && result.koreaConnection === true
    && result.categoryRelevant === true
    && result.recentActivity === true;

  return {
    discoveryStatus: qualitativePass && !coreUnknown ? "qualified" : "needs_review",
    verificationStatus: coreUnknown ? "insufficient" : "verified",
  } as const;
}

function normalizeIso(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
