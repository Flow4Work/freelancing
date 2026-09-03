import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { launchOpenCodeDmBatch } from "@/lib/automation/opencode-dm-launcher";
import { createApprovedDmContacts, recordDmOpenCodeResult, type DmContact } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const itemSchema = z.object({
  handle: z.string().min(1).max(80),
  japaneseText: z.string().min(1).max(3000),
  koreanText: z.string().min(1).max(3000),
});

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  items: z.array(itemSchema).min(1).max(30),
});

export async function POST(request: Request) {
  let contacts: DmContact[] = [];
  try {
    assertLocalRequest(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "DM batch 승인 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    contacts = await createApprovedDmContacts(parsed.data.items.map((item) => ({
      category: parsed.data.category,
      handle: item.handle,
      japaneseText: item.japaneseText,
      koreanText: item.koreanText,
    })));

    if (contacts.length !== parsed.data.items.length) {
      throw new Error(`DM 승인 이력 저장 수가 일치하지 않습니다: ${contacts.length}/${parsed.data.items.length}`);
    }

    const launched = await launchOpenCodeDmBatch(contacts.map((contact) => ({
      contactId: contact.id,
      handle: contact.handle,
      approvedJapaneseText: contact.japaneseText,
    })));

    return NextResponse.json({
      ok: true,
      contacts,
      processId: launched.processId,
      candidateCount: launched.candidateCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM batch 승인/OpenCode 실행 중 오류가 발생했습니다.";
    console.error("dm_batch_approve_failed", error);

    if (contacts.length) {
      await Promise.allSettled(contacts.map((contact) => recordDmOpenCodeResult({
        id: contact.id,
        handle: contact.handle,
        status: "failed",
        error: message,
      })));
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
