import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { prepareCandidateDm, type PreparedDm } from "@/lib/dm/prepare";
import { getDmPreparationCandidates, savePreparedDm } from "@/lib/supabase/candidates";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handles: z.array(z.string().min(1).max(30).regex(/^[A-Za-z0-9._]+$/).refine((handle) => isValidHandle(handle), "Instagram ID가 올바르지 않습니다.")).min(1).max(30),
  forceRegenerate: z.boolean().optional().default(false),
});

type PreparedResponseItem = {
  handle: string;
  japaneseText: string;
  koreanText: string;
  generatedAt: string;
  provider: string;
  model: string;
};

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "DM 준비 대상이 올바르지 않습니다." }, { status: 400 });
    }

    const handles = [...new Set(parsed.data.handles.map((handle) => normalizeHandle(handle)))];
    if (handles.length !== parsed.data.handles.length || handles.some((handle, index) => handle !== parsed.data.handles[index] || !isValidHandle(handle) || handle.includes("\\"))) {
      return NextResponse.json({ ok: false, error: "DM 준비 대상 Instagram handle이 올바르지 않습니다." }, { status: 400 });
    }

    const foundCandidates = await getDmPreparationCandidates(parsed.data.category, handles);
    const candidateByHandle = new Map(foundCandidates.map((candidate) => [candidate.handle, candidate]));
    const candidates = handles.flatMap((handle) => {
      const candidate = candidateByHandle.get(handle);
      return candidate ? [candidate] : [];
    });
    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: "최종 검증 완료 후보가 없습니다." }, { status: 409 });
    }
    if (candidates.length !== handles.length) {
      const missing = handles.filter((handle) => !candidateByHandle.has(handle));
      return NextResponse.json({ ok: false, error: `DM 준비 가능한 후보 수가 일치하지 않습니다: ${candidates.length}/${handles.length}${missing.length ? ` · ${missing.map((handle) => `@${handle}`).join(", ")}` : ""}` }, { status: 409 });
    }

    // 이 API까지 호출됐다는 것은 현재 화면의 미승인 동일-handle 초안을 재사용할 조건이 아니라는 뜻이다.
    // 승인/완료된 과거 contact history는 새 DM 준비를 막거나 재사용하지 않는다.
    const prepared = await mapWithConcurrency(candidates, 1, prepareCandidateDm);
    await savePreparedDm(parsed.data.category, prepared);

    return NextResponse.json(buildPreparedResponse(prepared.map(toResponseItem)));
  } catch (error) {
    console.error("dm_prepare_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 준비 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
}

function toResponseItem(item: PreparedDm): PreparedResponseItem {
  return {
    handle: item.handle,
    japaneseText: item.dmText,
    koreanText: item.koreanText,
    generatedAt: item.generatedAt,
    provider: item.provider,
    model: item.model,
  };
}

function buildPreparedResponse(items: PreparedResponseItem[]) {
  return {
    ok: true,
    preparedCount: items.length,
    providerCounts: countProviders(items),
    models: [...new Set(items.map((item) => item.model))],
    items,
    reused: false,
  };
}

function countProviders(items: Array<{ provider: string }>) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.provider] = (counts[item.provider] ?? 0) + 1;
    return counts;
  }, {});
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
