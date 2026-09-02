import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { launchOpenCodeDmInput } from "@/lib/automation/opencode-dm-launcher";
import { translateDmToKorean } from "@/lib/dm/prepare";
import { createApprovedDmContact, recordDmOpenCodeResult } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handle: z.string().min(1).max(80),
  japaneseText: z.string().min(1).max(3000),
});

export async function POST(request: Request) {
  let contactId: string | null = null;
  let handle = "";
  try {
    assertLocalRequest(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "DM 승인 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    handle = parsed.data.handle.replace(/^@/, "").trim().toLowerCase();
    const japaneseText = parsed.data.japaneseText;
    if (!japaneseText.trim()) {
      return NextResponse.json({ ok: false, error: "일본어 DM 원문이 비어 있습니다." }, { status: 400 });
    }
    const koreanText = await translateDmToKorean(japaneseText);
    const contact = await createApprovedDmContact({
      category: parsed.data.category,
      handle,
      japaneseText,
      koreanText,
    });
    contactId = contact.id;

    const launched = await launchOpenCodeDmInput({
      contactId: contact.id,
      handle: contact.handle,
      approvedJapaneseText: contact.japaneseText,
    });

    return NextResponse.json({
      ok: true,
      contact,
      koreanText: contact.koreanText,
      processId: launched.processId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM 승인/OpenCode 실행 중 오류가 발생했습니다.";
    console.error("dm_approve_failed", error);
    if (contactId && handle) {
      try {
        await recordDmOpenCodeResult({ id: contactId, handle, status: "failed", error: message });
      } catch (saveError) {
        console.error("dm_approve_failure_save_failed", saveError);
      }
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
