import type { SearchCategory } from "@/lib/discovery/types";
import { normalizeHandle } from "@/lib/discovery/instagram";
import { getSupabaseAdmin } from "./admin";

export type VerificationJobKind = "duplicate" | "instagram";

export type RecentVerificationJob = {
  id: string;
  category: SearchCategory;
  handles: string[];
  status: "pending" | "completed";
  createdAt: string;
  completedAt: string | null;
  jobKind: VerificationJobKind;
};

export async function createVerificationJob(
  category: SearchCategory,
  handles: string[],
  jobKind: VerificationJobKind = "instagram",
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const normalized = normalizeHandles(handles);
  if (!normalized.length) throw new Error("처리할 후보가 없습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .insert({ category, handles: normalized, job_kind: jobKind })
    .select("id")
    .single();

  if (error || !data?.id) throw new Error(`작업 생성 실패: ${error?.message ?? "job id 없음"}`);
  return String(data.id);
}

export async function listRecentVerificationJobs(category: SearchCategory, limit = 5): Promise<RecentVerificationJob[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, category, handles, status, created_at, completed_at, job_kind")
    .eq("category", category)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`작업 기록 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    category,
    handles: normalizeHandles(Array.isArray(row.handles) ? row.handles.map(String) : []),
    status: row.status === "completed" ? "completed" : "pending",
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    jobKind: row.job_kind === "duplicate" ? "duplicate" : "instagram",
  }));
}

export async function assertVerificationJob(
  jobId: string,
  category: SearchCategory,
  handles: string[],
  expectedKind: VerificationJobKind = "instagram",
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const submitted = handles.map(normalizeHandle);
  if (new Set(submitted).size !== submitted.length) throw new Error("결과에 중복 계정이 포함되어 있습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, category, handles, status, created_at, job_kind")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error("존재하지 않는 작업입니다.");
  if (String(data.status) !== "pending") throw new Error("이미 완료된 작업입니다.");
  if (String(data.category) !== category) throw new Error("작업 장르가 일치하지 않습니다.");
  if (String(data.job_kind ?? "instagram") !== expectedKind) throw new Error("작업 종류가 일치하지 않습니다.");

  const createdAt = Date.parse(String(data.created_at));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 6 * 60 * 60 * 1000) {
    throw new Error("작업이 6시간을 지나 만료되었습니다. 다시 실행하세요.");
  }

  const expected = normalizeHandles(Array.isArray(data.handles) ? data.handles.map(String) : []);
  const actual = normalizeHandles(submitted);
  if (expected.length !== actual.length || expected.some((handle, index) => handle !== actual[index])) {
    throw new Error("작업 후보 목록과 제출 결과가 일치하지 않습니다.");
  }
}

export async function completeVerificationJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { error } = await supabase
    .from("creator_verification_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "pending");

  if (error) throw new Error(`작업 완료 처리 실패: ${error.message}`);
}

function normalizeHandles(handles: string[]) {
  return [...new Set(handles.map(normalizeHandle))].sort();
}
