import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { launchOpenCodeDmBatch } from "@/lib/automation/opencode-dm-launcher";
import { getDmContact, reformatApprovedDmContactsForRetry } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  contactIds: z.array(z.string().uuid()).min(1).max(30),
  reformatParagraphs: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "DM resume 입력이 올바르지 않습니다." }, { status: 400 });
    }

    const uniqueIds = [...new Set(parsed.data.contactIds)];
    if (uniqueIds.length !== parsed.data.contactIds.length) {
      return NextResponse.json({ ok: false, error: "DM resume contactId가 중복되었습니다." }, { status: 400 });
    }

    const contacts = await Promise.all(uniqueIds.map((id) => getDmContact(id)));
    if (contacts.some((contact) => !contact)) {
      return NextResponse.json({ ok: false, error: "DM resume contact를 찾지 못했습니다." }, { status: 404 });
    }

    let resolved = contacts.map((contact) => contact!);
    const invalid = resolved.find((contact) =>
      contact.category !== parsed.data.category
      || contact.approvalStatus !== "approved"
      || Boolean(contact.sentAt),
    );
    if (invalid) {
      return NextResponse.json({ ok: false, error: `@${invalid.handle} 은 현재 resume 가능한 승인 contact가 아닙니다.` }, { status: 409 });
    }

    if (parsed.data.reformatParagraphs) {
      resolved = await reformatApprovedDmContactsForRetry(parsed.data.category, uniqueIds);
    }

    const pending = resolved.filter((contact) => contact.openCodeStatus === "pending");
    if (!pending.length) {
      return NextResponse.json({ ok: true, requestedCount: resolved.length, skippedCompleted: resolved.length, pendingCount: 0, launched: false });
    }

    const launched = await launchOpenCodeDmBatch(pending.map((contact) => ({
      contactId: contact.id,
      handle: contact.handle,
      approvedJapaneseText: contact.japaneseText,
    })));

    return NextResponse.json({
      ok: true,
      requestedCount: resolved.length,
      skippedCompleted: resolved.length - pending.length,
      pendingCount: pending.length,
      launched: true,
      processId: launched.processId,
      promptCount: launched.promptCount,
      reformattedCount: parsed.data.reformatParagraphs ? resolved.length : 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM resume 실행 중 오류가 발생했습니다.";
    console.error("dm_resume_failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
