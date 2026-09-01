import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    providers: {
      exa: Boolean(process.env.EXA_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY),
      supabase: isSupabaseConfigured(),
    },
  });
}
