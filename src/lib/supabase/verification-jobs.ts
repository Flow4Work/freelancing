import type { SearchCategory } from "@/lib/discovery/types";
import { normalizeHandle } from "@/lib/discovery/instagram";
import { getCandidateViewState } from "@/lib/discovery/presentation";
import { listCandidates } from "./candidates";
import { getSupabaseAdmin } from "./admin";

export type VerificationJobKind = "duplicate" | "instagram";
export type VerificationJobStatus = "pending" | "completed" | "failed";
export type VerificationJobDestination =
  | "검증 필요"
  | "추천 후보"
  | "중복 통과"
  | "최종 검증 완료"
  | "DM 준비"
  | "제외"
  | "미반영";

export type VerificationJobResultGroup = {
  destination: VerificationJobDestination;
  handles: string[];
  reasons: Array<{ handle: string; reason: string }>;
};

export type VerificationJobResultSummary = {
  version: 1;
  capturedAt: string;
  groups: VerificationJobResultGroup[];
};

export type RecentVerificationJob = {
  id: string;
  category: SearchCategory;
  handles: string[];
  processedHandles: string[];
  status: VerificationJobStatus;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  jobKind: VerificationJobKind;
  resultSummary: VerificationJobResultSummary | null;
};

export type VerificationJobProgress = {
  id: string;
  status: VerificationJobStatus;
  processedCount: number;
  totalCount: number;
  failureMessage: string | null;
};

const DESTINATIONS: VerificationJobDestination[] = [
  "최종 검증 완료",
  "DM 준비",
  "중복 통과",
  "추천 후보",
  "검증 필요",
  "제외",
  "미반영",
];

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
    .insert({ category, handles: normalized, processed_handles: [], job_kind: jobKind })
    .select("id")
    .single();

  if (error || !data?.id) throw new Error(`작업 생성 실패: ${error?.message ?? "job id 없음"}`);
  return String(data.id);
}

export async function listRecentVerificationJobs(category: SearchCategory, limit = 8): Promise<RecentVerificationJob[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, category, handles, processed_handles, status, created_at, completed_at, failed_at, failure_message, job_kind, result_summary")
    .eq("category", category)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`작업 기록 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    category,
    handles: normalizeHandles(Array.isArray(row.handles) ? row.handles.map(String) : []),
    processedHandles: normalizeHandles(Array.isArray(row.processed_handles) ? row.processed_handles.map(String) : []),
    status: normalizeJobStatus(row.status),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    failedAt: row.failed_at ? String(row.failed_at) : null,
    failureMessage: nullableString(row.failure_message),
    jobKind: row.job_kind === "duplicate" ? "duplicate" : "instagram",
    resultSummary: normalizeResultSummary(row.result_summary),
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

  const submitted = handles.map(normalizeHandle).filter(Boolean);
  if (!submitted.length) throw new Error("제출 결과가 비어 있습니다.");
  if (new Set(submitted).size !== submitted.length) throw new Error("결과에 중복 계정이 포함되어 있습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, category, handles, status, created_at, job_kind")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error("존재하지 않는 작업입니다.");
  const status = normalizeJobStatus(data.status);
  if (status === "completed") throw new Error("이미 완료된 작업입니다.");
  if (status === "failed") throw new Error("이미 실패 처리된 작업입니다. 남은 후보만 다시 실행하세요.");
  if (String(data.category) !== category) throw new Error("작업 장르가 일치하지 않습니다.");
  if (String(data.job_kind ?? "instagram") !== expectedKind) throw new Error("작업 종류가 일치하지 않습니다.");

  const createdAt = Date.parse(String(data.created_at));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 6 * 60 * 60 * 1000) {
    throw new Error("작업이 6시간을 지나 만료되었습니다. 다시 실행하세요.");
  }

  const expected = new Set(normalizeHandles(Array.isArray(data.handles) ? data.handles.map(String) : []));
  const unexpected = submitted.filter((handle) => !expected.has(handle));
  if (unexpected.length) {
    throw new Error(`작업 후보가 아닌 계정이 포함되어 있습니다: ${unexpected.map((handle) => `@${handle}`).join(", ")}`);
  }
}

export async function recordVerificationJobProgress(
  jobId: string,
  category: SearchCategory,
  handles: string[],
): Promise<VerificationJobProgress> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, handles, processed_handles, status, failure_message")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error("작업 진행률을 찾지 못했습니다.");
  const expected = normalizeHandles(Array.isArray(data.handles) ? data.handles.map(String) : []);
  const current = normalizeHandles(Array.isArray(data.processed_handles) ? data.processed_handles.map(String) : []);
  const merged = normalizeHandles([...current, ...handles]);
  const status = normalizeJobStatus(data.status);

  if (status !== "pending") {
    return {
      id: jobId,
      status,
      processedCount: current.length,
      totalCount: expected.length,
      failureMessage: nullableString(data.failure_message),
    };
  }

  const expectedSet = new Set(expected);
  const processed = merged.filter((handle) => expectedSet.has(handle));
  const completed = expected.length > 0 && processed.length === expected.length;
  const now = new Date().toISOString();

  if (completed) {
    const resultSummary = await buildResultSummary(category, expected);
    const { error: updateError } = await supabase
      .from("creator_verification_jobs")
      .update({
        processed_handles: processed,
        status: "completed",
        completed_at: now,
        failed_at: null,
        failure_message: null,
        result_summary: resultSummary,
      })
      .eq("id", jobId)
      .eq("status", "pending");

    if (updateError) throw new Error(`작업 완료 처리 실패: ${updateError.message}`);
    return { id: jobId, status: "completed", processedCount: processed.length, totalCount: expected.length, failureMessage: null };
  }

  const { error: updateError } = await supabase
    .from("creator_verification_jobs")
    .update({ processed_handles: processed })
    .eq("id", jobId)
    .eq("status", "pending");

  if (updateError) throw new Error(`작업 진행률 저장 실패: ${updateError.message}`);
  return { id: jobId, status: "pending", processedCount: processed.length, totalCount: expected.length, failureMessage: null };
}

export async function getVerificationJobProgress(jobId: string): Promise<VerificationJobProgress> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, handles, processed_handles, status, failure_message")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error("존재하지 않는 작업입니다.");
  const handles = normalizeHandles(Array.isArray(data.handles) ? data.handles.map(String) : []);
  const processed = normalizeHandles(Array.isArray(data.processed_handles) ? data.processed_handles.map(String) : []);
  return {
    id: jobId,
    status: normalizeJobStatus(data.status),
    processedCount: processed.length,
    totalCount: handles.length,
    failureMessage: nullableString(data.failure_message),
  };
}

export async function failVerificationJob(jobId: string, message: string): Promise<VerificationJobProgress> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const cleanMessage = message.replace(/[\t\r\n ]+/g, " ").trim().slice(0, 500) || "OpenCode 작업이 완료되지 않았습니다.";
  const { error } = await supabase
    .from("creator_verification_jobs")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_message: cleanMessage,
    })
    .eq("id", jobId)
    .eq("status", "pending");

  if (error) throw new Error(`작업 실패 상태 저장 실패: ${error.message}`);
  return getVerificationJobProgress(jobId);
}

export async function completeVerificationJob(jobId: string, category: SearchCategory, handles: string[]) {
  return recordVerificationJobProgress(jobId, category, handles);
}

async function buildResultSummary(category: SearchCategory, handles: string[]): Promise<VerificationJobResultSummary> {
  const normalized = normalizeHandles(handles);
  const requested = new Set(normalized);
  const candidates = (await listCandidates(category)).filter((candidate) => requested.has(candidate.handle));
  const candidateMap = new Map(candidates.map((candidate) => [candidate.handle, candidate]));
  const grouped = new Map<VerificationJobDestination, VerificationJobResultGroup>();

  function add(destination: VerificationJobDestination, handle: string, reason?: string) {
    const group = grouped.get(destination) ?? { destination, handles: [], reasons: [] };
    group.handles.push(handle);
    if (reason) group.reasons.push({ handle, reason });
    grouped.set(destination, group);
  }

  for (const handle of normalized) {
    const candidate = candidateMap.get(handle);
    if (!candidate) {
      add("미반영", handle, "결과 저장 후 후보를 찾지 못함");
      continue;
    }

    const state = getCandidateViewState(candidate);
    if (state === "verification_needed") add("검증 필요", handle);
    else if (state === "recommended") add("추천 후보", handle);
    else if (state === "duplicate_passed") add("중복 통과", handle);
    else if (state === "final_verification") add("최종 검증 완료", handle);
    else if (state === "dm_ready") add("DM 준비", handle);
    else add("제외", handle, exclusionReason(candidate));
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    groups: DESTINATIONS.map((destination) => grouped.get(destination)).filter((group): group is VerificationJobResultGroup => Boolean(group?.handles.length)),
  };
}

function exclusionReason(candidate: Awaited<ReturnType<typeof listCandidates>>[number]) {
  if (candidate.duplicateCheckStatus === "duplicate") return "FixUp 중복";
  if (candidate.duplicateCheckStatus === "protected") return "보호 목록";
  if (candidate.verificationStatus === "private") return "비공개 계정";
  if (candidate.verificationNote) return candidate.verificationNote;
  if (candidate.accountAvailability === "unavailable") return "계정 없음";
  if (candidate.accountType === "business") return "업체/공식 계정";
  if (candidate.koreaAffinity === "none") return "한국 접점 없음";
  if (candidate.eligibility === "fail") return "현재 후보 조건 부적합";
  return "후보 제외";
}

function normalizeResultSummary(value: unknown): VerificationJobResultSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.groups)) return null;

  const groups = row.groups.flatMap((item): VerificationJobResultGroup[] => {
    if (!item || typeof item !== "object") return [];
    const group = item as Record<string, unknown>;
    const destination = String(group.destination) as VerificationJobDestination;
    if (!DESTINATIONS.includes(destination)) return [];
    const handles = normalizeHandles(Array.isArray(group.handles) ? group.handles.map(String) : []);
    if (!handles.length) return [];
    const reasons = Array.isArray(group.reasons)
      ? group.reasons.flatMap((reason): Array<{ handle: string; reason: string }> => {
        if (!reason || typeof reason !== "object") return [];
        const reasonRow = reason as Record<string, unknown>;
        const handle = normalizeHandle(String(reasonRow.handle ?? ""));
        const text = String(reasonRow.reason ?? "").trim();
        return handle && text ? [{ handle, reason: text }] : [];
      })
      : [];
    return [{ destination, handles, reasons }];
  });

  return {
    version: 1,
    capturedAt: String(row.capturedAt ?? ""),
    groups,
  };
}

function normalizeJobStatus(value: unknown): VerificationJobStatus {
  if (value === "completed" || value === "failed") return value;
  return "pending";
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function normalizeHandles(handles: string[]) {
  return [...new Set(handles.map(normalizeHandle).filter(Boolean))].sort();
}
