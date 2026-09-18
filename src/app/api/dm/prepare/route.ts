import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { prepareCandidateDmSync } from "@/lib/dm/prepare";
import { getDmPreparationCandidates, savePreparedDm } from "@/lib/supabase/candidates";
import { listUnsentDmContacts } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  handles: z.array(z.string().min(1).max(30).regex(/^[A-Za-z0-9._]+$/).refine(isValidHandle)).min(1).max(30),
  forceRegenerate: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: "DM 준비 입력이 올바르지 않습니다." }, { status: 400 });
    const handles = parsed.data.handles.map(normalizeHandle);
    if (new Set(handles).size !== handles.length || handles.some((handle, index) => handle !== parsed.data.handles[index] || !isValidHandle(handle) || handle.includes("\\"))) {
      return NextResponse.json({ ok: false, error: "Instagram handle이 올바르지 않습니다." }, { status: 400 });
    }
    const latestContacts = await listUnsentDmContacts(parsed.data.category);
    const sentConfirmed = new Set(latestContacts.filter((contact) => Boolean(contact.sentAt)).map((contact) => contact.handle));
    const alreadySent = handles.filter((handle) => sentConfirmed.has(handle));
    if (alreadySent.length) return NextResponse.json({ ok: false, error: `Already sent-confirmed contacts cannot be prepared again: ${alreadySent.map((handle) => `@${handle}`).join(", ")}` }, { status: 409 });
    const found = await getDmPreparationCandidates(parsed.data.category, handles);
    const byHandle = new Map(found.map((candidate) => [candidate.handle, candidate]));
    const missing = handles.filter((handle) => !byHandle.has(handle));
    if (missing.length) return NextResponse.json({ ok: false, error: `DM 준비 가능한 최종 검증 후보가 아닙니다: ${missing.map((handle) => `@${handle}`).join(", ")}` }, { status: 409 });
    const prepared = handles.map((handle) => prepareCandidateDmSync(byHandle.get(handle)!));
    await savePreparedDm(parsed.data.category, prepared);
    return NextResponse.json({
      ok: true,
      preparedCount: prepared.length,
      providerCounts: { deterministic: prepared.length },
      models: ["deterministic-dm-context-v1"],
      items: prepared.map((item) => ({
        handle: item.handle,
        japaneseText: item.dmText,
        generatedAt: item.generatedAt,
        provider: item.provider,
        model: item.model,
      })),
      reused: false,
    });
  } catch (error) {
    console.error("dm_prepare_failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DM 준비 오류" }, { status: 500 });
  }
}