import { NextResponse } from "next/server";
import { z } from "zod";
import { listCandidates, manuallyExcludeCandidate } from "@/lib/supabase/candidates";

export const runtime = "nodejs";

const categorySchema = z.enum(["beauty", "food"]);
const querySchema = z.object({
  category: categorySchema,
});
const patchSchema = z.object({
  category: categorySchema,
  handle: z.string().min(1).max(30),
  action: z.literal("manual_exclude"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ category: url.searchParams.get("category") });
  if (!parsed.success) {
    return NextResponse.json({ error: "장르가 올바르지 않습니다." }, { status: 400 });
  }

  const candidates = await listCandidates(parsed.data.category);
  return NextResponse.json({ category: parsed.data.category, candidates });
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "수동 제외 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const result = await manuallyExcludeCandidate(parsed.data.category, parsed.data.handle);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "수동 제외 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
