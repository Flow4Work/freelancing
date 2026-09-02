import { NextResponse } from "next/server";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Destination = "검증 필요" | "추천 후보" | "중복 통과" | "최종 검증 완료" | "DM 준비" | "제외" | "미반영";
type Group = { destination: Destination; handles: string[]; reasons: Array<{ handle: string; reason: string }> };

const DESTINATIONS: Destination[] = ["최종 검증 완료", "DM 준비", "중복 통과", "추천 후보", "검증 필요", "제외", "미반영"];

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const category = new URL(request.url).searchParams.get("category");
    if (category !== "beauty" && category !== "food") {
      return NextResponse.json({ ok: false, error: "장르가 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

    const { data: jobs, error: jobsError } = await supabase
      .from("creator_verification_jobs")
      .select("id, handles, status, created_at, completed_at, job_kind, result_summary")
      .eq("category", category)
      .order("created_at", { ascending: false })
      .limit(12);

    if (jobsError) throw new Error(`작업 기록 조회 실패: ${jobsError.message}`);

    const allHandles = [...new Set((jobs ?? []).flatMap((job) => normalizeHandles(job.handles)))];
    const candidateMap = new Map<string, Record<string, unknown>>();

    if (allHandles.length) {
      const { data: candidates, error: candidateError } = await supabase
        .from("creator_candidates")
        .select("normalized_handle, discovery_status, verification_status, duplicate_check_status, duplicate_check_message, verification_note")
        .eq("category", category)
        .in("normalized_handle", allHandles);

      if (candidateError) throw new Error(`현재 후보 상태 조회 실패: ${candidateError.message}`);
      for (const candidate of candidates ?? []) candidateMap.set(String(candidate.normalized_handle), candidate as Record<string, unknown>);
    }

    const items = (jobs ?? []).map((job) => {
      const handles = normalizeHandles(job.handles);
      const snapshot = normalizeSnapshot(job.result_summary);
      const groups = snapshot ?? buildCurrentGroups(handles, candidateMap);

      return {
        id: String(job.id),
        mode: job.job_kind === "duplicate" ? "duplicate" : "instagram",
        status: job.status === "completed" ? "completed" : "pending",
        candidateCount: handles.length,
        createdAt: String(job.created_at),
        completedAt: job.completed_at ? String(job.completed_at) : null,
        groups,
        exactSnapshot: Boolean(snapshot),
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 기록 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function buildCurrentGroups(handles: string[], candidateMap: Map<string, Record<string, unknown>>): Group[] {
  const groups = new Map<Destination, Group>();

  function add(destination: Destination, handle: string, reason?: string) {
    const group = groups.get(destination) ?? { destination, handles: [], reasons: [] };
    group.handles.push(handle);
    if (reason) group.reasons.push({ handle, reason });
    groups.set(destination, group);
  }

  for (const handle of handles) {
    const candidate = candidateMap.get(handle);
    if (!candidate) {
      add("미반영", handle, "현재 후보 목록에서 찾지 못함");
      continue;
    }

    const discovery = String(candidate.discovery_status ?? "");
    const verification = String(candidate.verification_status ?? "");
    const duplicate = String(candidate.duplicate_check_status ?? "not_checked");
    const reason = String(candidate.duplicate_check_message ?? candidate.verification_note ?? "후보 제외");

    if (duplicate === "duplicate" || duplicate === "protected") {
      add("제외", handle, reason || (duplicate === "duplicate" ? "FixUp 중복" : "보호 목록"));
      continue;
    }
    if (verification === "private" || verification === "rejected" || verification === "hard_reject") {
      add("제외", handle, reason);
      continue;
    }
    if (duplicate === "available") {
      if (verification === "verified" && (discovery === "qualified" || discovery === "search_qualified")) add("최종 검증 완료", handle);
      else if (verification === "needs_instagram" || verification === "insufficient") add("중복 통과", handle);
      else add("제외", handle, reason);
      continue;
    }
    if (discovery === "search_qualified" || discovery === "qualified") add("추천 후보", handle);
    else if (discovery === "discovered" || discovery === "needs_review") add("검증 필요", handle);
    else if (discovery === "contacted") add("DM 준비", handle);
    else add("제외", handle, reason);
  }

  return DESTINATIONS.map((destination) => groups.get(destination)).filter((group): group is Group => Boolean(group?.handles.length));
}

function normalizeSnapshot(value: unknown): Group[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.groups)) return null;

  const groups = raw.groups.flatMap((item): Group[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const destination = String(row.destination) as Destination;
    if (!DESTINATIONS.includes(destination)) return [];
    const handles = normalizeHandles(row.handles);
    if (!handles.length) return [];
    const reasons = Array.isArray(row.reasons)
      ? row.reasons.flatMap((reason): Array<{ handle: string; reason: string }> => {
        if (!reason || typeof reason !== "object") return [];
        const reasonRow = reason as Record<string, unknown>;
        const handle = normalizeHandle(reasonRow.handle);
        const text = String(reasonRow.reason ?? "").trim();
        return handle && text ? [{ handle, reason: text }] : [];
      })
      : [];
    return [{ destination, handles, reasons }];
  });

  return groups.length ? groups : null;
}

function normalizeHandles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeHandle).filter(Boolean))];
}

function normalizeHandle(value: unknown) {
  return String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
}
