import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { prepareCandidateDm, type PreparedDm } from "@/lib/dm/prepare";
import { getDmPreparationCandidates, savePreparedDm } from "@/lib/supabase/candidates";
import { listUnsentDmContacts } from "@/lib/supabase/dm-contacts";

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

    if (parsed.data.forceRegenerate) {
      const regenerated = await mapWithConcurrency(candidates, 1, prepareCandidateDm);
      await savePreparedDm(parsed.data.category, regenerated);
      return NextResponse.json(buildPreparedResponse(regenerated.map(toResponseItem), false));
    }

    const contacts = await listUnsentDmContacts(parsed.data.category);
    const reusableByHandle = new Map<string, PreparedResponseItem>();
    const generateCandidates: typeof candidates = [];
    const incompleteStoredHandles: string[] = [];

    for (const candidate of candidates) {
      const hasAnyStoredDm = Boolean(
        candidate.dmText
        || candidate.dmGeneratedAt
        || candidate.dmProvider
        || candidate.dmModel,
      );
      const hasCompleteStoredDm = Boolean(
        candidate.dmText
        && candidate.dmGeneratedAt
        && candidate.dmProvider
        && candidate.dmModel,
      );

      if (!hasAnyStoredDm) {
        generateCandidates.push(candidate);
        continue;
      }
      if (!hasCompleteStoredDm) {
        incompleteStoredHandles.push(candidate.handle);
        continue;
      }

      const contact = contacts.find((item) => (
        item.handle === candidate.handle
        && sameInstant(item.generatedAt, candidate.dmGeneratedAt)
        && Boolean(item.japaneseText.trim())
        && Boolean(item.koreanText.trim())
      ));
      if (!contact) {
        incompleteStoredHandles.push(candidate.handle);
        continue;
      }

      reusableByHandle.set(candidate.handle, {
        handle: candidate.handle,
        japaneseText: contact.japaneseText,
        koreanText: contact.koreanText,
        generatedAt: candidate.dmGeneratedAt as string,
        provider: candidate.dmProvider as string,
        model: candidate.dmModel as string,
      });
    }

    if (incompleteStoredHandles.length) {
      return NextResponse.json({
        ok: false,
        error: `기존 DM 초안은 있지만 현재 작업의 전체 내용을 안전하게 복구하지 못했습니다. 자동 재생성하지 않았습니다. 명시적인 다시 생성을 사용하세요: ${incompleteStoredHandles.map((handle) => `@${handle}`).join(", ")}`,
      }, { status: 409 });
    }

    const generated = generateCandidates.length
      ? await mapWithConcurrency(generateCandidates, 1, prepareCandidateDm)
      : [];
    if (generated.length) await savePreparedDm(parsed.data.category, generated);
    const generatedByHandle = new Map(generated.map((item) => [item.handle, toResponseItem(item)]));

    const items = handles.map((handle) => {
      const item = reusableByHandle.get(handle) ?? generatedByHandle.get(handle);
      if (!item) throw new Error(`@${handle} DM 준비 결과를 찾지 못했습니다.`);
      return item;
    });

    return NextResponse.json(buildPreparedResponse(items, generated.length === 0));
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

function buildPreparedResponse(items: PreparedResponseItem[], reused: boolean) {
  return {
    ok: true,
    preparedCount: items.length,
    providerCounts: countProviders(items),
    models: [...new Set(items.map((item) => item.model))],
    items,
    reused,
  };
}

function countProviders(items: Array<{ provider: string }>) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.provider] = (counts[item.provider] ?? 0) + 1;
    return counts;
  }, {});
}

function sameInstant(first: string, second: string | null | undefined) {
  if (!second) return false;
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  return Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime === secondTime;
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
