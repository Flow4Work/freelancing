import type { SearchCategory } from "@/lib/discovery/types";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { decideVerification } from "@/lib/verification/decision";
import { computeReelMetrics } from "@/lib/verification/metrics";
import type { InstagramVerificationResult } from "@/lib/verification/result-contract";
import { getSupabaseAdmin } from "./admin";

export async function applyInstagramVerificationResults(category: SearchCategory, results: InstagramVerificationResult[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const normalizedResults = results
    .map((result) => ({ ...result, handle: normalizeHandle(result.handle) }));

  const invalidHandles = normalizedResults.filter((result) => !isValidHandle(result.handle));
  if (invalidHandles.length) {
    throw new Error(`Invalid verification handle: ${invalidHandles.map((result) => `@${result.handle || "(empty)"}`).join(", ")}`);
  }

  const handles = [...new Set(normalizedResults.map((result) => result.handle))];
  const { data: candidates, error: candidateError } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, followers, followers_source, discovery_status")
    .eq("category", category)
    .in("normalized_handle", handles);

  if (candidateError) throw new Error(`Candidate lookup failed: ${candidateError.message}`);

  const allowed = new Set((candidates ?? []).map((row) => String(row.normalized_handle)));
  const missingHandles = handles.filter((handle) => !allowed.has(handle));
  if (missingHandles.length) {
    throw new Error(`Verification candidates not found: ${missingHandles.map((handle) => `@${handle}`).join(", ")}`);
  }

  const exactExistingFollowers = new Map<string, number | null>((candidates ?? []).map((row): [string, number | null] => [
    String(row.normalized_handle),
    row.followers_source === "instagram" && typeof row.followers === "number" && Number.isFinite(row.followers)
      ? row.followers
      : null,
  ]));
  const existingDiscoveryStatus = new Map<string, string>((candidates ?? []).map((row): [string, string] => [
    String(row.normalized_handle),
    String(row.discovery_status ?? ""),
  ]));
  let updated = 0;

  for (const result of normalizedResults) {

    // 최종 검증에서 followers를 읽지 못한 경우 search 참고값을 정확값처럼 재사용하지 않는다.
    // 이전에 Instagram에서 직접 확인된 값만 안전한 fallback으로 허용한다.
    const followers = result.followers ?? exactExistingFollowers.get(result.handle) ?? null;
    const metrics = computeReelMetrics(result.reels);
    const decision = decideVerification({
      category,
      duplicateStatus: result.duplicateStatus,
      exists: result.exists,
      isPrivate: result.isPrivate,
      isPersonalCreator: result.isPersonalCreator,
      bio: result.bio,
      followers,
      recentActivity: result.recentActivity,
      japaneseTarget: result.japaneseTarget,
      koreaConnection: result.koreaConnection,
      categoryRelevant: result.categoryRelevant,
      creatorSignals: result.creatorSignals,
      targetSignals: result.targetSignals,
      koreaSignals: result.koreaSignals,
      categorySignals: result.categorySignals,
      reelMetrics: metrics,
      note: result.note,
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

    const previousDiscoveryStatus = existingDiscoveryStatus.get(result.handle);
    const discoveryStatus = decision.verificationStatus === "insufficient"
      && (previousDiscoveryStatus === "search_qualified" || previousDiscoveryStatus === "needs_review")
      ? previousDiscoveryStatus
      : decision.discoveryStatus;

    const patch: Record<string, unknown> = {
      duplicate_check_status: result.duplicateStatus,
      duplicate_check_message: result.duplicateMessage,
      duplicate_checked_at: now,
      account_availability: result.exists === true ? "active" : result.exists === false ? "unavailable" : "unknown",
      account_type: result.isPersonalCreator === false
        ? "business"
        : result.isPersonalCreator === true && result.creatorSignals.length > 0
          ? "creator"
          : "unknown",
      korea_affinity: result.koreaConnection === false
        ? "none"
        : result.koreaConnection === true && result.koreaSignals.length > 0
          ? "yes"
          : "unknown",
      content_fit: result.categoryRelevant === true && result.categorySignals.length > 0 ? category : "other",
      eligibility: decision.discoveryStatus === "qualified" ? "possible" : decision.discoveryStatus === "hard_reject" || decision.discoveryStatus === "private" ? "fail" : "unknown",
      activity: result.recentActivity === true ? "active" : "unknown",
      target_signals: result.targetSignals,
      korea_signals: result.koreaSignals,
      bio: result.bio,
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
      discovery_status: discoveryStatus,
      verified_at: now,
      updated_at: now,
    };

    if (result.followers !== null) {
      patch.followers = result.followers;
      patch.followers_source = "instagram";
    }

    const { error } = await supabase
      .from("creator_candidates")
      .update(patch)
      .eq("normalized_handle", result.handle)
      .eq("category", category);

    if (error) throw new Error(`@${result.handle} 검증 저장 실패: ${error.message}`);
    updated += 1;
  }

  return { updated, ignored: 0 };
}

function normalizeIso(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
