import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { prepareCandidateDm } from "@/lib/dm/prepare";
import { getDmPreparationCandidates, savePreparedDm } from "@/lib/supabase/candidates";
import { listUnsentDmContacts } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handles: z.array(z.string().min(1).max(30).regex(/^[A-Za-z0-9._]+$/).refine((handle) => isValidHandle(handle), "Instagram ID가 올바르지 않습니다.")).min(1).max(30),
  forceRegenerate: z.boolean().optional().default(false),
});

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

    if (!parsed.data.forceRegenerate) {
      const existingDmCandidates = candidates.filter((candidate) => (
        candidate.dmText
        && candidate.dmGeneratedAt
        && candidate.dmProvider
        && candidate.dmModel
      ));

      if (existingDmCandidates.length) {
        const contacts = await listUnsentDmContacts(parsed.data.category);
        const reusable = existingDmCandidates.map((candidate) => {
          const contact = contacts.find((item) => (
            item.handle === candidate.handle
            && sameInstant(item.generatedAt, candidate.dmGeneratedAt)
            && item.japaneseText === candidate.dmText
            && Boolean(item.koreanText.trim())
          ));
          if (!contact) return null;
          return {
            handle: candidate.handle,
            japaneseText: candidate.dmText as string,
            koreanText: contact.koreanText,
            generatedAt: candidate.dmGeneratedAt as string,
            provider: candidate.dmProvider as string,
            model: candidate.dmModel as string,
          };
        });

        if (existingDmCandidates.length === candidates.length && reusable.every(Boolean)) {
          const items = reusable.filter((item): item is NonNullable<typeof item> => Boolean(item));
          return NextResponse.json({
            ok: true,
            preparedCount: items.length,
            providerCounts: countProviders(items),
            models: [...new Set(items.map((item) => item.model))],
            items,
            reused: true,
          });
        }

        const unrecoverable = existingDmCandidates
          .filter((candidate, index) => !reusable[index])
          .map((candidate) => candidate.handle);
        if (unrecoverable.length) {
          return NextResponse.json({
            ok: false,
            error: `기존 DM 초안은 있지만 현재 작업의 한국어 해석을 안전하게 복구하지 못했습니다. 자동 재생성하지 않았습니다. 명시적인 다시 생성을 사용하세요: ${unrecoverable.map((handle) => `@${handle}`).join(", ")}`,
          }, { status: 409 });
        }
      }
    }

    const prepared = await mapWithConcurrency(candidates, 1, prepareCandidateDm);
    await savePreparedDm(parsed.data.category, prepared);

    const providerCounts = prepared.reduce<Record<string, number>>((counts, item) => {
      counts[item.provider] = (counts[item.provider] ?? 0) + 1;
      return counts;
    }, {});

    return NextResponse.json({
      ok: true,
      preparedCount: prepared.length,
      providerCounts,
      models: [...new Set(prepared.map((item) => item.model))],
      items: prepared.map((item) => ({
        handle: item.handle,
        japaneseText: item.dmText,
        koreanText: item.koreanText,
        generatedAt: item.generatedAt,
        provider: item.provider,
        model: item.model,
      })),
      reused: false,
    });
  } catch (error) {
    console.error("dm_prepare_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 준비 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
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
