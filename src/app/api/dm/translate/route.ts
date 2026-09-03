import { NextResponse } from "next/server";
import { z } from "zod";
import { translateDmToKorean } from "@/lib/dm/prepare";

export const runtime = "nodejs";

const bodySchema = z.object({
  japaneseText: z.string().min(1).max(3000),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "번역할 일본어 DM이 올바르지 않습니다." }, { status: 400 });
    }

    const koreanText = await translateDmToKorean(parsed.data.japaneseText);
    return NextResponse.json({ ok: true, koreanText });
  } catch (error) {
    console.error("dm_translate_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 번역 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
}
