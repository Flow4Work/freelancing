import { NextResponse } from "next/server";
import { z } from "zod";
import { applyInstagramVerificationResults } from "@/lib/supabase/verification";
import { assertVerificationJob, recordVerificationJobProgress } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const reelSchema = z.object({
  url: z.string().max(500).nullable(),
  postedAt: z.string().max(64).nullable(),
  views: z.number().int().nonnegative().nullable(),
});

const resultSchema = z.object({
  handle: z.string().min(1).max(30),
  duplicateStatus: z.enum(["available", "duplicate", "protected", "unknown"]),
  duplicateMessage: z.string().max(500).nullable(),
  exists: z.boolean().nullable(),
  isPrivate: z.boolean().nullable(),
  isPersonalCreator: z.boolean().nullable(),
  bio: z.string().max(2000).nullable(),
  followers: z.number().int().nonnegative().nullable(),
  recentActivity: z.boolean().nullable(),
  lastActivityAt: z.string().max(64).nullable(),
  japaneseTarget: z.boolean().nullable(),
  koreaConnection: z.boolean().nullable(),
  categoryRelevant: z.boolean().nullable(),
  reels: z.array(reelSchema).max(10),
  note: z.string().max(500).nullable(),
});

const bodySchema = z.object({
  jobId: z.string().uuid(),
  category: z.enum(["beauty", "food"]),
  results: z.array(resultSchema).min(1).max(30),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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
