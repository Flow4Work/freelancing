import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest, assertOpenCodeAvailable, assertOpenCodeRunnable, launchOpenCodeJob } from "@/lib/automation/opencode-launcher";
import { buildDuplicateCheckPrompt } from "@/lib/discovery/duplicate-prompt";
import { buildOpenCodeVerificationPrompt } from "@/lib/discovery/opencode-prompt";
import { getCandidateViewState } from "@/lib/discovery/presentation";
import type { DiscoveryCandidate } from "@/lib/discovery/types";
import { getAutomationCandidates, listCandidates } from "@/lib/supabase/candidates";
import { createVerificationJob, listRecentVerificationJobs, type VerificationJobDestination, type VerificationJobResultGroup } from "@/lib/supabase/verification-jobs";

export const runtime = "nodejs";

const categorySchema = z.enum(["beauty", "food"]);
const bodySchema = z.object({
  category: categorySchema,
  mode: z.enum(["duplicate", "instagram"]),
  handles: z.array(z.string().min(1).max(30)).min(1).max(30),
});

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const category = categorySchema.parse(new URL(request.url).searchParams.get("category"));
    const [jobs, candidates] = await Promise.all([
      listRecentVerificationJobs(category, 8),
      listCandidates(category),
    ]);
    const candidateMap = new Map(candidates.map((candidate) => [candidate.handle, candidate]));

    const items = jobs.map((job) => {
      const groups = job.resultSummary?.groups
        ?? (job.status === "completed" ? buildLegacyGroups(job.handles, candidateMap) : []);
      const excludedCount = groupCount(groups, "제외");
      const unresolvedCount = groupCount(groups, "미반영");
      const destinationGroups = groups.filter((group) => group.destination !== "제외" && group.destination !== "미반영");
      const mainDestination = [...destinationGroups].sort((a, b) => b.handles.length - a.handles.length)[0];

      return {
        id: job.id,
        mode: job.jobKind,
        status: job.status,
        candidateCount: job.handles.length,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        destination: mainDestination?.destination ?? (job.jobKind === "duplicate" ? "중복 통과" : "최종 검증 완료"),
        destinationCount: mainDestination?.handles.length ?? 0,
        excludedCount,
        unresolvedCount,
        groups,
        exactSnapshot: Boolean(job.resultSummary),
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 기록 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

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
      const label = parsed.data.mode === "duplicate" ? "추천 후보/검증 필요" : "중복 통과";
      return NextResponse.json({ ok: false, error: `${label} 상태에서 실행할 후보가 없습니다.` }, { status: 409 });
    }

    // 실제 작업을 만들기 전에 현재 OpenCode 기본 모델/provider가 응답 가능한지 짧게 확인한다.
    // 크레딧/사용량 제한, 인증, 모델/provider 장애면 pending job을 만들지 않고 정확한 원문을 반환한다.
    assertOpenCodeRunnable();

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

function buildLegacyGroups(handles: string[], candidateMap: Map<string, DiscoveryCandidate>): VerificationJobResultGroup[] {
  const groups = new Map<VerificationJobDestination, VerificationJobResultGroup>();

  function add(destination: VerificationJobDestination, handle: string, reason?: string) {
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

    const state = getCandidateViewState(candidate);
    if (state === "verification_needed") add("검증 필요", handle);
    else if (state === "recommended") add("추천 후보", handle);
    else if (state === "duplicate_passed") add("중복 통과", handle);
    else if (state === "final_verification") add("최종 검증 완료", handle);
    else if (state === "dm_ready") add("DM 준비", handle);
    else add("제외", handle, legacyExclusionReason(candidate));
  }

  return [...groups.values()];
}

function legacyExclusionReason(candidate: DiscoveryCandidate) {
  if (candidate.duplicateCheckStatus === "duplicate") return "FixUp 중복";
  if (candidate.duplicateCheckStatus === "protected") return "보호 목록";
  if (candidate.verificationStatus === "private") return "비공개 계정";
  return candidate.verificationNote ?? "후보 제외";
}

function groupCount(groups: VerificationJobResultGroup[], destination: VerificationJobDestination) {
  return groups.find((group) => group.destination === destination)?.handles.length ?? 0;
}
