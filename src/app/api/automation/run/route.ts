import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest, assertOpenCodeAvailable, launchOpenCodeJob } from "@/lib/automation/opencode-launcher";
import { buildDuplicateCheckPrompt } from "@/lib/discovery/duplicate-prompt";
import { buildOpenCodeVerificationPrompt } from "@/lib/discovery/opencode-prompt";
import { getAutomationCandidates } from "@/lib/supabase/candidates";
import { createVerificationJob } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  mode: z.enum(["duplicate", "instagram"]),
  handles: z.array(z.string().min(1).max(30)).min(1).max(30),
});

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    assertOpenCodeAvailable();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "자동 실행 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const candidates = await getAutomationCandidates(parsed.data.category, parsed.data.handles, parsed.data.mode);
    if (!candidates.length) {
      const label = parsed.data.mode === "duplicate" ? "검증 필요/추천 후보" : "중복 통과";
      return NextResponse.json({ ok: false, error: `${label} 상태에서 실행할 후보가 없습니다.` }, { status: 409 });
    }

    const jobId = await createVerificationJob(parsed.data.category, candidates.map((candidate) => candidate.handle), parsed.data.mode);
    const prompt = parsed.data.mode === "duplicate"
      ? buildDuplicateCheckPrompt(candidates, parsed.data.category, jobId)
      : buildOpenCodeVerificationPrompt(candidates, parsed.data.category, jobId);

    await launchOpenCodeJob({
      prompt,
      jobId,
      title: parsed.data.mode === "duplicate" ? "중복 확인" : "Instagram 원본 검증",
    });

    return NextResponse.json({
      ok: true,
      jobId,
      mode: parsed.data.mode,
      candidateCount: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenCode 자동 실행에 실패했습니다.";
    console.error("automation_run_failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
