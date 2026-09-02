import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { recordDmOpenCodeResult } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const bodySchema = z.object({
  contactId: z.string().uuid(),
  handle: z.string().min(1).max(80),
  status: z.enum(["success", "failed"]),
  error: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "OpenCode DM 결과가 올바르지 않습니다." }, { status: 400 });
    }

    const contact = await recordDmOpenCodeResult({
      id: parsed.data.contactId,
      handle: parsed.data.handle,
      status: parsed.data.status,
      error: parsed.data.error,
    });
    return NextResponse.json({ ok: true, contact });
  } catch (error) {
    console.error("dm_opencode_result_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "OpenCode DM 결과 저장 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
}
