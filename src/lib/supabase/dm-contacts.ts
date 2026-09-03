import type { SearchCategory } from "@/lib/discovery/types";
import { normalizeHandle } from "@/lib/discovery/instagram";
import { getSupabaseAdmin } from "./admin";

export type DmOpenCodeStatus = "pending" | "success" | "failed";

export type DmContact = {
  id: string;
  handle: string;
  category: SearchCategory;
  japaneseText: string;
  koreanText: string;
  generatedAt: string;
  approvedAt: string;
  approvalStatus: "approved";
  openCodeStatus: DmOpenCodeStatus;
  openCodeCompletedAt: string | null;
  openCodeError: string | null;
  sentAt: string | null;
};

type ApprovedDmContactInput = {
  category: SearchCategory;
  handle: string;
  japaneseText: string;
  koreanText: string;
};

export async function createApprovedDmContacts(inputs: ApprovedDmContactInput[]) {
  if (!inputs.length) throw new Error("승인할 DM이 없습니다.");

  const supabase = requireSupabase();
  const categories = new Set(inputs.map((input) => input.category));
  if (categories.size !== 1) throw new Error("한 번의 DM 승인 batch에는 하나의 장르만 사용할 수 있습니다.");
  const category = inputs[0].category;

  const normalizedInputs = inputs.map((input) => {
    const handle = normalizeHandle(input.handle);
    if (!handle) throw new Error("Instagram ID가 올바르지 않습니다.");
    const japaneseText = input.japaneseText;
    const koreanText = input.koreanText.trim();
    if (!japaneseText.trim()) throw new Error(`@${handle} 승인 일본어 DM이 비어 있습니다.`);
    if (!koreanText) throw new Error(`@${handle} 승인 한국어 DM 해석이 비어 있습니다.`);
    return { ...input, handle, japaneseText, koreanText };
  });

  const duplicateHandles = normalizedInputs
    .map((input) => input.handle)
    .filter((handle, index, all) => all.indexOf(handle) !== index);
  if (duplicateHandles.length) {
    throw new Error(`DM 승인 batch에 중복 handle이 있습니다: ${[...new Set(duplicateHandles)].map((handle) => `@${handle}`).join(", ")}`);
  }

  const handles = normalizedInputs.map((input) => input.handle);
  const { data: candidates, error: candidateError } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, dm_generated_at")
    .eq("category", category)
    .eq("duplicate_check_status", "available")
    .eq("verification_status", "verified")
    .eq("discovery_status", "qualified")
    .in("normalized_handle", handles);

  if (candidateError) {
    throw new Error(`DM 승인 후보 확인 실패: ${candidateError.message}`);
  }

  const candidateByHandle = new Map(
    (candidates ?? []).map((candidate) => [String(candidate.normalized_handle), candidate]),
  );
  const missing = handles.filter((handle) => !candidateByHandle.has(handle));
  if (missing.length) {
    throw new Error(`현재 DM 준비 가능한 최종 검증 완료 후보가 아닙니다: ${missing.map((handle) => `@${handle}`).join(", ")}`);
  }

  const missingGeneratedAt = handles.filter((handle) => {
    const candidate = candidateByHandle.get(handle);
    return !candidate?.dm_generated_at;
  });
  if (missingGeneratedAt.length) {
    throw new Error(`DM 준비 생성 기록이 없습니다. 다시 생성하세요: ${missingGeneratedAt.map((handle) => `@${handle}`).join(", ")}`);
  }

  const approvedAt = new Date().toISOString();
  const rows = normalizedInputs.map((input) => ({
    normalized_handle: input.handle,
    category,
    japanese_text: input.japaneseText,
    korean_text: input.koreanText,
    generated_at: String(candidateByHandle.get(input.handle)?.dm_generated_at),
    approved_at: approvedAt,
    approval_status: "approved",
    opencode_status: "pending",
  }));

  const { data, error } = await supabase
    .from("creator_dm_contact_history")
    .insert(rows)
    .select(CONTACT_COLUMNS);

  if (error || !data || data.length !== rows.length) {
    throw new Error(`DM 승인 이력 batch 저장 실패: ${error?.message ?? `저장 ${data?.length ?? 0}/${rows.length}건`}`);
  }

  const savedByHandle = new Map(data.map((row) => [String(row.normalized_handle), mapContact(row)]));
  return normalizedInputs.map((input) => {
    const contact = savedByHandle.get(input.handle);
    if (!contact) throw new Error(`@${input.handle} DM 승인 이력 저장 결과를 찾지 못했습니다.`);
    return contact;
  });
}

export async function createApprovedDmContact(input: ApprovedDmContactInput) {
  const contacts = await createApprovedDmContacts([input]);
  return contacts[0];
}

export async function listUnsentDmContacts(category: SearchCategory) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("creator_dm_contact_history")
    .select(CONTACT_COLUMNS)
    .eq("category", category)
    .is("sent_at", null)
    .order("approved_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`DM 연락 이력 조회 실패: ${error.message}`);
  return (data ?? []).map(mapContact);
}

export async function getDmContact(id: string) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("creator_dm_contact_history")
    .select(CONTACT_COLUMNS)
    .eq("id", id)
    .single();

  if (error || !data) throw new Error("DM 연락 이력을 찾지 못했습니다.");
  return mapContact(data);
}

export async function recordDmOpenCodeResult(input: {
  id: string;
  handle: string;
  status: "success" | "failed";
  error?: string | null;
}) {
  const current = await getDmContact(input.id);
  const handle = normalizeHandle(input.handle);
  if (!handle || handle !== current.handle) throw new Error("DM 연락 이력의 Instagram ID가 일치하지 않습니다.");
  if (current.sentAt) throw new Error("이미 발송 완료된 DM 연락 이력입니다.");
  if (current.openCodeStatus === "success") return current;

  const supabase = requireSupabase();
  const now = new Date().toISOString();
  const errorText = input.status === "failed"
    ? cleanError(input.error ?? "OpenCode가 Instagram DM 입력을 완료하지 못했습니다.")
    : null;

  const { data, error } = await supabase
    .from("creator_dm_contact_history")
    .update({
      opencode_status: input.status,
      opencode_completed_at: now,
      opencode_error: errorText,
    })
    .eq("id", input.id)
    .eq("normalized_handle", handle)
    .is("sent_at", null)
    .select(CONTACT_COLUMNS)
    .single();

  if (error || !data) throw new Error(`OpenCode DM 상태 저장 실패: ${error?.message ?? "저장 결과 없음"}`);
  return mapContact(data);
}

export async function markDmContactSent(id: string) {
  const current = await getDmContact(id);
  if (current.sentAt) return current;
  if (current.openCodeStatus !== "success") {
    throw new Error("OpenCode 입력 준비가 완료된 DM만 발송 완료로 기록할 수 있습니다.");
  }

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("creator_dm_contact_history")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("opencode_status", "success")
    .is("sent_at", null)
    .select(CONTACT_COLUMNS)
    .single();

  if (error || !data) throw new Error(`DM 발송 완료 저장 실패: ${error?.message ?? "저장 결과 없음"}`);
  return mapContact(data);
}

const CONTACT_COLUMNS = "id, normalized_handle, category, japanese_text, korean_text, generated_at, approved_at, approval_status, opencode_status, opencode_completed_at, opencode_error, sent_at";

function mapContact(row: Record<string, unknown>): DmContact {
  const category = row.category === "food" ? "food" : "beauty";
  return {
    id: String(row.id),
    handle: String(row.normalized_handle),
    category,
    japaneseText: String(row.japanese_text ?? ""),
    koreanText: String(row.korean_text ?? ""),
    generatedAt: String(row.generated_at),
    approvedAt: String(row.approved_at),
    approvalStatus: "approved",
    openCodeStatus: normalizeOpenCodeStatus(row.opencode_status),
    openCodeCompletedAt: nullableString(row.opencode_completed_at),
    openCodeError: nullableString(row.opencode_error),
    sentAt: nullableString(row.sent_at),
  };
}

function normalizeOpenCodeStatus(value: unknown): DmOpenCodeStatus {
  if (value === "success" || value === "failed") return value;
  return "pending";
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function cleanError(value: string) {
  return value.replace(/[\t\r\n ]+/g, " ").trim().slice(0, 500) || "OpenCode DM 입력 실패";
}

function requireSupabase() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
  return supabase;
}
