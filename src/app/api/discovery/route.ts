import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverCreators, NoSearchProvidersError } from "@/lib/discovery/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  category: z.enum(["beauty", "food"]),
  targetCount: z.number().int().min(10).max(300).default(120),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const result = await discoverCreators(input);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NoSearchProvidersError) {
      return NextResponse.json({ error: "EXA_API_KEY 또는 TAVILY_API_KEY 중 하나를 먼저 설정해주세요." }, { status: 503 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "검색 조건이 올바르지 않습니다.", details: error.issues }, { status: 400 });
    }
    console.error("discovery_failed", error);
    return NextResponse.json({ error: "후보 검색 중 오류가 발생했습니다." }, { status: 500 });
  }
}
