import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/admin";
import { runQualitySelfCheck } from "@/lib/discovery/self-check";

export const runtime = "nodejs";

export async function GET() {
  const quality = runQualitySelfCheck();
  return NextResponse.json({
    ok: quality.ok,
    quality,
    providers: {
      exa: Boolean(process.env.EXA_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY),
      supabase: isSupabaseConfigured(),
    },
  }, { status: quality.ok ? 200 : 500 });
}
