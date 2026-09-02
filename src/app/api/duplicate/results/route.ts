import { NextResponse } from "next/server";
import { z } from "zod";
import { applyDuplicateCheckResults } from "@/lib/supabase/duplicate-check";
import { assertVerificationJob, recordVerificationJobProgress } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const resultSchema = z.object({
  handle: z.string().min(1).max(30),
  duplicateStatus: z.enum(["available", "duplicate", "protected", "unknown"]),
  duplicateMessage: z.string().max(500).nullable(),
  followers: z.number().int().nonnegative().nullable().optional(),
});

const bodySchema = z.object({
  jobId: z.string().uuid(),
  category: z.enum(["beauty", "food"]),
  results: z.array(resultSchema).min(1).max(30),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "중복 확인 결과 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const handles = parsed.data.results.map((result) => result.handle);
    await assertVerificationJob(parsed.data.jobId, parsed.data.category, handles, "duplicate");
    const saved = await applyDuplicateCheckResults(parsed.data.category, parsed.data.results);
    if (saved.updated !== parsed.data.results.length) {
      throw new Error(`중복 확인 ${parsed.data.results.length}건 중 ${saved.updated}건만 저장되어 진행률을 갱신하지 않았습니다.`);
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
    const message = error instanceof Error ? error.message : "중복 확인 결과 저장 실패";
    console.error("duplicate_result_failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
