import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { getDmContact, listUnsentDmContacts, markDmContactSent } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const sentSchema = z.object({ id: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (id) {
      const contact = await getDmContact(id);
      return NextResponse.json({ ok: true, contact });
    }

    const category = url.searchParams.get("category");
    if (category !== "beauty" && category !== "food") {
      return NextResponse.json({ ok: false, error: "category가 올바르지 않습니다." }, { status: 400 });
    }

    const contacts = await listUnsentDmContacts(category);
    return NextResponse.json({ ok: true, contacts });
  } catch (error) {
    console.error("dm_contacts_get_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 연락 이력 조회 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = sentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "발송 완료 대상이 올바르지 않습니다." }, { status: 400 });
    }

    const contact = await markDmContactSent(parsed.data.id);
    return NextResponse.json({ ok: true, contact });
  } catch (error) {
    console.error("dm_contacts_sent_failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "DM 발송 완료 저장 중 오류가 발생했습니다.",
    }, { status: 500 });
  }
}
