import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { failVerificationJob, getVerificationJobProgress } from "@/lib/supabase/verification-jobs";

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
    const progress = await getVerificationJobProgress(jobId);
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
