import { NextResponse } from "next/server";
import { applyInstagramVerificationResults } from "@/lib/supabase/verification";
import { verificationPayloadSchema } from "@/lib/verification/result-contract";
import { assertVerificationJob, recordVerificationJobProgress } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = verificationPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "검증 결과 JSON 형식이 올바르지 않습니다.", details: parsed.error.issues }, { status: 400 });
  }

  try {
    const handles = parsed.data.results.map((result) => result.handle);
    await assertVerificationJob(parsed.data.jobId, parsed.data.category, handles, "instagram");
    const saved = await applyInstagramVerificationResults(parsed.data.category, parsed.data.results);
    if (saved.updated !== parsed.data.results.length) {
      throw new Error(`검증 결과 ${parsed.data.results.length}건 중 ${saved.updated}건만 저장되어 진행률을 갱신하지 않았습니다.`);
    }
    const progress = await recordVerificationJobProgress(parsed.data.jobId, parsed.data.category, handles);
    return NextResponse.json({
      ok: true,
      jobId: parsed.data.jobId,
      ...saved,
      status: progress.status,
      completed: progress.status === "completed",
      processedCount: progress.processedCount,
      totalCount: progress.totalCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검증 결과 저장 실패";
    console.error("verification_result_failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
