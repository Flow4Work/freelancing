import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareCandidateDm } from "@/lib/dm/prepare";
import { getDmPreparationCandidates, savePreparedDm } from "@/lib/supabase/candidates";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handles: z.array(z.string().min(1).max(80)).min(1).max(30),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "DM 준비 대상이 올바르지 않습니다." }, { status: 400 });
    }

    const handles = [...new Set(parsed.data.handles.map((handle) => handle.replace(/^@/, "").trim().toLowerCase()).filter(Boolean))];
    const candidates = await getDmPreparationCandidates(parsed.data.category, handles);
    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: "최종 검증 완료 후보가 없습니다." }, { status: 409 });
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
    });
  } catch (error) {
    console.error("dm_prepare_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 준비 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
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
