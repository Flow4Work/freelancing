import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { getSupabaseAdmin } from "./admin";

export type PlannedVisit = {
  id: string;
  candidateId: string | null;
  instagramHandle: string;
  plannedFor: string;
  memo: string;
  reminderAt: string;
  reminderSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function calculateReminderAt(plannedFor: string) {
  const monthMatch = plannedFor.match(MONTH_PATTERN);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) throw new Error("방한 예정 월이 올바르지 않습니다.");
    return formatUtcDate(new Date(Date.UTC(year, month - 2, 1)));
  }

  const dateMatch = plannedFor.match(DATE_PATTERN);
  if (!dateMatch) throw new Error("방한 예정 시기는 YYYY-MM 또는 YYYY-MM-DD 형식이어야 합니다.");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const plannedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    plannedDate.getUTCFullYear() !== year
    || plannedDate.getUTCMonth() !== month - 1
    || plannedDate.getUTCDate() !== day
  ) {
    throw new Error("방한 예정 날짜가 올바르지 않습니다.");
  }
  plannedDate.setUTCDate(plannedDate.getUTCDate() - 28);
  return formatUtcDate(plannedDate);
}

export function getKoreaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function listPlannedVisits() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("creator_planned_visits")
    .select("id, candidate_id, instagram_handle, planned_for, memo, reminder_at, reminder_seen_at, created_at, updated_at")
    .order("planned_for", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`예정 목록 조회 실패: ${error.message}`);
  return (data ?? []).map(mapPlannedVisit);
}

export async function createPlannedVisit(rawHandle: string, plannedFor: string, memo = "") {
  const supabase = requireSupabase();
  const instagramHandle = validateHandle(rawHandle);
  const reminderAt = calculateReminderAt(plannedFor);
  const candidateId = await findCandidateId(instagramHandle);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("creator_planned_visits")
    .insert({
      candidate_id: candidateId,
      instagram_handle: instagramHandle,
      planned_for: plannedFor,
      memo: cleanMemo(memo),
      reminder_at: reminderAt,
      updated_at: now,
    })
    .select("id, candidate_id, instagram_handle, planned_for, memo, reminder_at, reminder_seen_at, created_at, updated_at")
    .single();

  if (error) throw new Error(`예정 등록 실패: ${error.message}`);
  return mapPlannedVisit(data);
}

export async function updatePlannedVisit(id: string, plannedFor: string, memo = "") {
  const supabase = requireSupabase();
  const { data: current, error: readError } = await supabase
    .from("creator_planned_visits")
    .select("instagram_handle, planned_for, reminder_seen_at")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(`예정 조회 실패: ${readError.message}`);
  if (!current) throw new Error("수정할 예정 기록을 찾지 못했습니다.");

  const reminderAt = calculateReminderAt(plannedFor);
  const candidateId = await findCandidateId(String(current.instagram_handle));
  const plannedChanged = String(current.planned_for) !== plannedFor;
  const { data, error } = await supabase
    .from("creator_planned_visits")
    .update({
      candidate_id: candidateId,
      planned_for: plannedFor,
      memo: cleanMemo(memo),
      reminder_at: reminderAt,
      reminder_seen_at: plannedChanged ? null : current.reminder_seen_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, candidate_id, instagram_handle, planned_for, memo, reminder_at, reminder_seen_at, created_at, updated_at")
    .single();

  if (error) throw new Error(`예정 수정 실패: ${error.message}`);
  return mapPlannedVisit(data);
}

export async function deletePlannedVisit(id: string) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("creator_planned_visits").delete().eq("id", id);
  if (error) throw new Error(`예정 삭제 실패: ${error.message}`);
}

export async function markDuePlannedVisitsSeen() {
  const supabase = requireSupabase();
  const now = new Date().toISOString();
  const today = getKoreaToday();
  const { data, error } = await supabase
    .from("creator_planned_visits")
    .update({ reminder_seen_at: now, updated_at: now })
    .is("reminder_seen_at", null)
    .lte("reminder_at", today)
    .select("id");
  if (error) throw new Error(`예정 읽음 처리 실패: ${error.message}`);
  return data?.length ?? 0;
}

export function countDueUnseenPlannedVisits(items: PlannedVisit[]) {
  const today = getKoreaToday();
  return items.filter((item) => !item.reminderSeenAt && item.reminderAt <= today).length;
}

async function findCandidateId(instagramHandle: string) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("creator_candidates")
    .select("id")
    .eq("normalized_handle", instagramHandle)
    .maybeSingle();
  if (error) throw new Error(`기존 후보 연결 확인 실패: ${error.message}`);
  return data?.id ? String(data.id) : null;
}

function requireSupabase() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
  return supabase;
}

function validateHandle(rawHandle: string) {
  const handle = normalizeHandle(rawHandle);
  if (!isValidHandle(handle)) throw new Error("Instagram 계정이 올바르지 않습니다.");
  return handle;
}

function cleanMemo(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1000);
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mapPlannedVisit(row: Record<string, unknown>): PlannedVisit {
  return {
    id: String(row.id),
    candidateId: row.candidate_id ? String(row.candidate_id) : null,
    instagramHandle: String(row.instagram_handle),
    plannedFor: String(row.planned_for),
    memo: String(row.memo ?? ""),
    reminderAt: String(row.reminder_at),
    reminderSeenAt: row.reminder_seen_at ? String(row.reminder_seen_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
