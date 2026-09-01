import { NextResponse } from "next/server";
import { z } from "zod";
import { applyInstagramVerificationResults } from "@/lib/supabase/verification";
import { assertVerificationJob, completeVerificationJob } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const reelSchema = z.object({
  url: z.string().max(500).nullable(),
  postedAt: z.string().max(64).nullable(),
  views: z.number().int().nonnegative().nullable(),
});

const resultSchema = z.object({
  handle: z.string().min(1).max(30),
  exists: z.boolean(),
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
    await assertVerificationJob(parsed.data.jobId, parsed.data.category, handles);
    const saved = await applyInstagramVerificationResults(parsed.data.category, parsed.data.results);
    await completeVerificationJob(parsed.data.jobId);
    return NextResponse.json({ ok: true, jobId: parsed.data.jobId, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검증 결과 저장 실패";
    console.error("verification_result_failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
