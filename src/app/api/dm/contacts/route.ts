import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { getDmContact, listUnsentDmContacts, returnDmContactsToFinalVerification } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (id) return NextResponse.json({ ok: true, contact: await getDmContact(id) });
    const category = url.searchParams.get("category");
    if (category !== "beauty" && category !== "food") return NextResponse.json({ ok: false, error: "invalid category" }, { status: 400 });
    return NextResponse.json({ ok: true, contacts: await listUnsentDmContacts(category) });
  } catch (error) {
    console.error("dm_contacts_get_failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DM contact history read failed" }, { status: 500 });
  }
}

const returnSchema = z.object({
  category: z.enum(["beauty", "food"]),
  contactIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function PATCH(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = returnSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "되돌리기 요청 형식이 올바르지 않습니다." }, { status: 400 });
    const contacts = await returnDmContactsToFinalVerification(parsed.data.category, parsed.data.contactIds);
    return NextResponse.json({ ok: true, movedCount: contacts.length, contacts });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "최종 검증 후보 되돌리기 실패" }, { status: 409 });
  }
}
