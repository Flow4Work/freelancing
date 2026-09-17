import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { isConfirmedSentEvidence } from "@/lib/dm/sent-sync";
import { getDmContact, getLatestDmContactForHandle, markDmContactSentFromSync } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";

const contactFields = {
  contactId: z.string().uuid(),
  handle: z.string().min(1).max(30).regex(/^[A-Za-z0-9._]+$/).refine(isValidHandle),
};
const errorField = z.string().max(300).optional().nullable();

const schema = z.discriminatedUnion("status", [
  z.object({
    ...contactFields,
    status: z.literal("sent"),
    evidence: z.object({
      text: z.string().min(1).max(10000),
      direction: z.literal("outgoing"),
      currentAttempt: z.literal("yes"),
    }),
  }),
  z.object({ ...contactFields, status: z.literal("not_sent"), error: errorField }),
  z.object({ ...contactFields, status: z.literal("uncertain"), error: errorField }),
]);

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const source = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const validation = {
        contactId: typeof source.contactId === "string" ? source.contactId : null,
        handle: typeof source.handle === "string" ? source.handle : null,
        status: typeof source.status === "string" ? source.status : null,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join(".") || "<root>",
          code: issue.code,
          message: issue.message,
        })),
      };
      console.error("dm_sent_sync_result_invalid", validation);
      return NextResponse.json({ ok: false, error: "invalid DM sync result", validation }, { status: 400 });
    }

    const handle = normalizeHandle(parsed.data.handle);
    const current = await getDmContact(parsed.data.contactId);
    if (handle !== parsed.data.handle || current.handle !== handle) {
      return NextResponse.json({ ok: false, error: "DM sync contact mismatch" }, { status: 409 });
    }

    const latest = await getLatestDmContactForHandle(current.category, handle);
    if (!latest || latest.id !== current.id) {
      return NextResponse.json({ ok: false, error: "DM sync contact is stale" }, { status: 409 });
    }

    if (parsed.data.status !== "sent") {
      return NextResponse.json({ ok: true, changed: false, contact: current });
    }

    if (!isConfirmedSentEvidence(current.japaneseText, [parsed.data.evidence])) {
      return NextResponse.json({
        ok: false,
        error: "DM sync outgoing evidence does not exactly match the latest approved DM",
      }, { status: 409 });
    }

    const contact = await markDmContactSentFromSync(parsed.data.contactId, handle);
    return NextResponse.json({ ok: true, changed: !current.sentAt && Boolean(contact.sentAt), contact });
  } catch (error) {
    console.error("dm_sent_sync_result_failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DM sent sync result failed" }, { status: 500 });
  }
}
