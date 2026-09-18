import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOpenCodeVerificationPrompt } from "@/lib/discovery/opencode-prompt";
import { getVerificationCandidates } from "@/lib/supabase/candidates";
import { createVerificationJob } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handles: z.array(z.string().min(1).max(30)).min(1).max(30),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "검증 후보 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const candidates = await getVerificationCandidates(parsed.data.category, parsed.data.handles);
    if (!candidates.length) {
      return NextResponse.json({ error: "현재 검증 가능한 후보가 없습니다. 이미 DM/검증된 계정은 자동 제외됩니다." }, { status: 409 });
    }

    const jobId = await createVerificationJob(parsed.data.category, candidates.map((candidate) => candidate.handle));
    const prompt = buildOpenCodeVerificationPrompt(candidates, parsed.data.category, jobId);
    return NextResponse.json({ jobId, candidateCount: candidates.length, prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검증 작업 생성 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
