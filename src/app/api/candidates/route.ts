import { NextResponse } from "next/server";
import { z } from "zod";
import { listCandidates } from "@/lib/supabase/candidates";

export const runtime = "nodejs";

const querySchema = z.object({
  category: z.enum(["beauty", "food"]),
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
