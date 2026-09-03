import type { DuplicateCheckStatus, FollowerSource, SearchCategory } from "@/lib/discovery/types";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { getSupabaseAdmin } from "./admin";

export type DuplicateCheckResult = {
  handle: string;
  duplicateStatus: Exclude<DuplicateCheckStatus, "not_checked">;
  duplicateMessage: string | null;
  followers?: number | null;
};

export async function applyDuplicateCheckResults(category: SearchCategory, results: DuplicateCheckResult[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const normalized = results
    .map((result) => ({ ...result, handle: normalizeHandle(result.handle) }))
    .filter((result) => isValidHandle(result.handle));

  const handles = [...new Set(normalized.map((result) => result.handle))];
  const [{ data: candidates, error: candidateError }, { data: contacted, error: contactedError }] = await Promise.all([
    supabase.from("creator_candidates").select("normalized_handle, followers, followers_source").eq("category", category).in("normalized_handle", handles),
    supabase.from("creator_contacted_handles").select("normalized_handle").in("normalized_handle", handles),
  ]);

  if (candidateError) throw new Error(`후보 확인 실패: ${candidateError.message}`);
  if (contactedError) throw new Error(`컨택 이력 확인 실패: ${contactedError.message}`);

  const allowed = new Set((candidates ?? []).map((row) => String(row.normalized_handle)));
  const existingFollowers = new Map<string, number | null>((candidates ?? []).map((row): [string, number | null] => [
    String(row.normalized_handle),
    typeof row.followers === "number" && Number.isFinite(row.followers) ? row.followers : null,
  ]));
  const existingFollowerSources = new Map<string, FollowerSource | null>((candidates ?? []).map((row): [string, FollowerSource | null] => [
    String(row.normalized_handle),
    normalizeFollowerSource(row.followers_source),
  ]));
  const blocked = new Set((contacted ?? []).map((row) => String(row.normalized_handle)));
  const now = new Date().toISOString();
  let updated = 0;

  for (const result of normalized) {
    if (!allowed.has(result.handle) || blocked.has(result.handle)) continue;

    const patch: Record<string, unknown> = {
      duplicate_check_status: result.duplicateStatus,
      duplicate_check_message: result.duplicateMessage,
      duplicate_checked_at: now,
      updated_at: now,
    };

    if (result.duplicateStatus === "duplicate" || result.duplicateStatus === "protected") {
      patch.discovery_status = "hard_reject";
      patch.verification_status = "rejected";
      patch.verification_note = result.duplicateStatus === "duplicate" ? "FixUp 중복" : "보호 목록";
    } else if (result.duplicateStatus === "available") {
      const currentFollowers = existingFollowers.get(result.handle) ?? null;
      const currentSource = existingFollowerSources.get(result.handle) ?? null;
      const submittedFollowers = normalizeSubmittedFollowers(result.followers);

      let exactFollowers: number | null = null;
      if (submittedFollowers !== null) {
        exactFollowers = submittedFollowers;
        patch.followers = submittedFollowers;
        patch.followers_source = "instagram";
      } else if (currentFollowers !== null && currentSource === "instagram") {
        exactFollowers = currentFollowers;
      }

      if (exactFollowers !== null && exactFollowers >= 100_000) {
        patch.discovery_status = "hard_reject";
        patch.verification_status = "rejected";
        patch.verification_note = `팔로워 초과 제외 · 팔로워 100,000 이상 (${exactFollowers.toLocaleString()}명)`;
      }
    }

    const { error } = await supabase
      .from("creator_candidates")
      .update(patch)
      .eq("normalized_handle", result.handle)
      .eq("category", category);

    if (error) throw new Error(`@${result.handle} 중복 확인 저장 실패: ${error.message}`);
    updated += 1;
  }

  return { updated, ignored: results.length - updated };
}

function normalizeSubmittedFollowers(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function normalizeFollowerSource(value: unknown): FollowerSource | null {
  return value === "search" || value === "instagram" ? value : null;
}
