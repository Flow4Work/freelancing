import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/automation/opencode-launcher";
import { isDmSentSyncRunning, launchOpenCodeDmSentSyncBatch } from "@/lib/automation/opencode-dm-sync-launcher";
import { listPendingSentSyncContacts } from "@/lib/supabase/dm-contacts";

export const runtime = "nodejs";
const bodySchema = z.object({
  category: z.enum(["beauty", "food"]),
  contactIds: z.array(z.string().uuid()).min(1).max(30).optional(),
});

export async function GET(request: Request) {
  try {
    const category = new URL(request.url).searchParams.get("category");
    if (category !== "beauty" && category !== "food") return NextResponse.json({ ok: false, error: "invalid category" }, { status: 400 });
    const [contacts, progress] = await Promise.all([listPendingSentSyncContacts(category), readDmSyncProgress(category)]);
    return NextResponse.json({ ok: true, pendingCount: contacts.length, ...progress });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DM sent sync status failed" }, { status: 500 });
  }
}


async function readDmSyncProgress(category: "beauty" | "food") {
  const root = path.join(process.cwd(), ".next", "cache", "fixup-scout");
  const names = await readdir(root).catch(() => [] as string[]);
  const pattern = new RegExp(`^dm-sent-sync-${category}-(\\d+)-(\\d+)\\.ps1$`);
  const batches = names.map((name) => ({ name, match: name.match(pattern) })).filter((item) => item.match).sort((a, b) => Number(b.match![1]) - Number(a.match![1]));
  const latest = batches[0];
  if (!latest) return { running: false, status: "idle", processedCount: 0, candidateCount: 0, sentCount: 0, notSentCount: 0, uncertainCount: 0, startedAt: null, updatedAt: null, failureMessage: null };
  const timestamp = Number(latest.match![1]);
  const candidateCount = Number(latest.match![2]);
  const base = path.join(root, latest.name.slice(0, -4));
  const attemptPath = `${base}.failed.attempts.jsonl`;
  const processed = new Set<string>(); const sent = new Set<string>(); const notSent = new Set<string>(); const uncertain = new Set<string>();
  const raw = await readFile(attemptPath, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type !== "tool_use" || event?.part?.tool !== "fixup_result_sync" || event?.part?.state?.status !== "completed") continue;
      const output = JSON.parse(event.part.state.output ?? "{}"); const id = output?.fixupReceipt?.id;
      if (!id || output?.fixupReceipt?.endpoint !== "/api/dm/sync-result") continue;
      processed.add(id); const resultStatus = event?.part?.state?.input?.payload?.status;
      if (resultStatus === "sent") sent.add(id); else if (resultStatus === "not_sent") notSent.add(id); else if (resultStatus === "uncertain") uncertain.add(id);
    } catch {}
  }
  const [running, failureMessage, attemptInfo, scriptInfo] = await Promise.all([
    isDmSentSyncRunning(category),
    readFile(`${base}.failed`, "utf8").then((value) => value.trim() || null).catch(() => null),
    stat(attemptPath).catch(() => null),
    stat(`${base}.ps1`).catch(() => null),
  ]);
  const status = running ? "running" : failureMessage ? "failed" : processed.size === candidateCount && candidateCount > 0 ? "completed" : "idle";
  return {
    running, status, processedCount: processed.size, candidateCount,
    sentCount: sent.size, notSentCount: notSent.size, uncertainCount: uncertain.size,
    startedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    updatedAt: (attemptInfo ?? scriptInfo)?.mtime?.toISOString() ?? null,
    failureMessage,
  };
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid sync input" }, { status: 400 });
    const allPending = await listPendingSentSyncContacts(parsed.data.category);
    const requestedIds = parsed.data.contactIds ? new Set(parsed.data.contactIds) : null;
    const contacts = (requestedIds ? allPending.filter((contact) => requestedIds.has(contact.id)) : allPending).slice(0, 30);
    if (!contacts.length) return NextResponse.json({ ok: true, launched: false, pendingCount: 0, candidateCount: 0 });
    const launched = await launchOpenCodeDmSentSyncBatch(parsed.data.category, contacts.map((contact) => ({
      contactId: contact.id,
      handle: contact.handle,
      approvedJapaneseText: contact.japaneseText,
      approvedAt: contact.approvedAt,
    })));
    return NextResponse.json({ ok: true, launched: !launched.alreadyRunning, alreadyRunning: launched.alreadyRunning, pendingCount: contacts.length, candidateCount: launched.candidateCount, processId: launched.processId });
  } catch (error) {
    console.error("dm_sent_sync_launch_failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DM sent sync launch failed" }, { status: 500 });
  }
}