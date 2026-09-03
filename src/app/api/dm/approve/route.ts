import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { launchOpenCodeDmBatch } from "@/lib/automation/opencode-dm-launcher";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { createApprovedDmContacts, recordDmOpenCodeResult, type DmContact } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const itemSchema = z.object({
  handle: z.string().min(1).max(30).regex(/^[A-Za-z0-9._]+$/).refine((handle) => isValidHandle(handle), "Instagram ID가 올바르지 않습니다."),
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

    const items = parsed.data.items.map((item) => {
      const normalized = normalizeHandle(item.handle);
      if (item.handle !== normalized || !isValidHandle(item.handle) || item.handle.includes("\\")) {
        throw new Error(`실제 Instagram handle이 올바르지 않습니다: ${JSON.stringify(item.handle)}`);
      }
      return item;
    });

    const requestedCount = items.length;
    const uniqueHandles = new Set(items.map((item) => item.handle));
    if (uniqueHandles.size !== requestedCount) {
      throw new Error(`DM 승인 요청 handle 수가 일치하지 않습니다: ${uniqueHandles.size}/${requestedCount}`);
    }

    contacts = await createApprovedDmContacts(items.map((item) => ({
      category: parsed.data.category,
      handle: item.handle,
      japaneseText: item.japaneseText,
      koreanText: item.koreanText,
    })));

    if (contacts.length !== requestedCount) {
      throw new Error(`DM 승인 이력 저장 수가 일치하지 않습니다: ${contacts.length}/${requestedCount}`);
    }
    const uniqueContactIds = new Set(contacts.map((contact) => contact.id));
    if (uniqueContactIds.size !== requestedCount) {
      throw new Error(`DM 승인 contactId 수가 일치하지 않습니다: ${uniqueContactIds.size}/${requestedCount}`);
    }
    for (let index = 0; index < requestedCount; index += 1) {
      if (contacts[index]?.handle !== items[index].handle) {
        throw new Error(`DM 승인 ${index + 1}번째 handle이 요청과 일치하지 않습니다.`);
      }
    }

    const launcherInputs = contacts.map((contact) => ({
      contactId: contact.id,
      handle: contact.handle,
      approvedJapaneseText: contact.japaneseText,
    }));
    if (launcherInputs.length !== requestedCount) {
      throw new Error(`DM launcher 입력 수가 일치하지 않습니다: ${launcherInputs.length}/${requestedCount}`);
    }

    const launched = await launchOpenCodeDmBatch(launcherInputs);
    if (
      launched.candidateCount !== requestedCount
      || launched.launcherCount !== requestedCount
      || launched.promptCount !== requestedCount
      || launched.openCodeRunCount !== 1
    ) {
      throw new Error(
        `DM batch 수량 검증 실패: 요청 ${requestedCount} / 승인 ${contacts.length} / launcher ${launched.launcherCount} / prompt ${launched.promptCount} / OpenCode ${launched.openCodeRunCount}회`,
      );
    }

    return NextResponse.json({
      ok: true,
      contacts,
      processId: launched.processId,
      candidateCount: launched.candidateCount,
      requestedCount,
      contactCount: contacts.length,
      launcherCount: launched.launcherCount,
      promptCount: launched.promptCount,
      openCodeRunCount: launched.openCodeRunCount,
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
