import type { DuplicateCheckStatus, SearchCategory } from "@/lib/discovery/types";
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
    supabase.from("creator_candidates").select("normalized_handle, followers").eq("category", category).in("normalized_handle", handles),
    supabase.from("creator_contacted_handles").select("normalized_handle").in("normalized_handle", handles),
  ]);

  if (candidateError) throw new Error(`후보 확인 실패: ${candidateError.message}`);
  if (contactedError) throw new Error(`컨택 이력 확인 실패: ${contactedError.message}`);

  const allowed = new Set((candidates ?? []).map((row) => String(row.normalized_handle)));
  const existingFollowers = new Map<string, number | null>((candidates ?? []).map((row): [string, number | null] => [
    String(row.normalized_handle),
    typeof row.followers === "number" && Number.isFinite(row.followers) ? row.followers : null,
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

    // 후보 찾기에서 확보한 followers는 그대로 보존한다.
    // 비어 있는 경우에만 available 판정 뒤 Instagram에서 실측한 값을 보강한다.
    const currentFollowers = existingFollowers.get(result.handle) ?? null;
    if (
      result.duplicateStatus === "available"
      && currentFollowers === null
      && typeof result.followers === "number"
      && Number.isFinite(result.followers)
      && result.followers >= 0
    ) {
      patch.followers = Math.round(result.followers);
    }

    if (result.duplicateStatus === "duplicate" || result.duplicateStatus === "protected") {
      patch.discovery_status = "hard_reject";
      patch.verification_status = "rejected";
      patch.verification_note = "FixUp 중복/보호목록";
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
