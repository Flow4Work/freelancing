import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { normalizeHandle } from "@/lib/discovery/instagram";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { failVerificationJob } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const jobIdSchema = z.string().uuid();
const failSchema = z.object({
  jobId: z.string().uuid(),
  error: z.string().min(1).max(500),
});

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const jobId = jobIdSchema.parse(new URL(request.url).searchParams.get("jobId"));
    const progress = await getVerificationJobResumeState(jobId);
    return NextResponse.json({ ok: true, ...progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 상태 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = failSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "작업 실패 보고 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const progress = await failVerificationJob(parsed.data.jobId, parsed.data.error);
    return NextResponse.json({ ok: true, ...progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 실패 상태 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}

async function getVerificationJobResumeState(jobId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");

  const { data, error } = await supabase
    .from("creator_verification_jobs")
    .select("id, handles, processed_handles, status, failure_message")
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error("존재하지 않는 작업입니다.");

  const handles = normalizeHandles(data.handles);
  const expected = new Set(handles);
  const processedHandles = normalizeHandles(data.processed_handles).filter((handle) => expected.has(handle));

  return {
    id: jobId,
    status: data.status === "completed" || data.status === "failed" ? data.status : "pending",
    processedCount: processedHandles.length,
    totalCount: handles.length,
    failureMessage: data.failure_message ? String(data.failure_message) : null,
    processedHandles,
  };
}

function normalizeHandles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeHandle(String(item))).filter(Boolean))].sort();
}
