import fs from "node:fs";
import path from "node:path";
import { loadTsModule } from "./fixup-ts-module-loader.mjs";

const root = process.cwd();
const toolPath = path.join(root, ".opencode", "tools", "fixup_result.ts");
const { syncPayloadSchema, sync } = loadTsModule(toolPath);
if (!syncPayloadSchema || !sync?.execute) throw new Error("sync tool exports unavailable");

const promptSource = fs.readFileSync(path.join(root, "src", "lib", "dm", "sync-prompt.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "src", "app", "api", "dm", "sync-result", "route.ts"), "utf8");
const contactsSource = fs.readFileSync(path.join(root, "src", "lib", "supabase", "dm-contacts.ts"), "utf8");
const progressSource = fs.readFileSync(path.join(root, "src", "app", "api", "dm", "sync", "route.ts"), "utf8");
const launcherSource = fs.readFileSync(path.join(root, "src", "lib", "automation", "opencode-dm-sync-launcher.ts"), "utf8");
const wrapperSource = fs.readFileSync(path.join(root, "scripts", "fixup-opencode-wrapper.ps1"), "utf8");
const toolSource = fs.readFileSync(toolPath, "utf8");

const cases = [];
const check = (name, ok, detail = "") => cases.push([name, Boolean(ok), detail]);
const A = { contactId: "fc0f76c4-5d9b-422e-b50c-2d7ff6608bc6", handle: "nagi_30life_" };
const sent = { ...A, status: "sent" };
const notSent = { ...A, status: "not_sent" };
const uncertain = { ...A, status: "uncertain", error: "browser unavailable" };

check("sent without legacy evidence parses", syncPayloadSchema.safeParse(sent).success);
check("not_sent parses", syncPayloadSchema.safeParse(notSent).success);
check("uncertain remains backward compatible", syncPayloadSchema.safeParse(uncertain).success);
check("invalid UUID rejected", !syncPayloadSchema.safeParse({ ...sent, contactId: "bad" }).success);
check("invalid handle rejected", !syncPayloadSchema.safeParse({ ...sent, handle: "bad..handle" }).success);
check("unknown status rejected", !syncPayloadSchema.safeParse({ ...A, status: "unknown" }).success);

const batch30 = Array.from({ length: 30 }, (_, index) => ({
  contactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  handle: `batchtest${index + 1}`,
  status: index % 2 ? "sent" : "not_sent",
}));
check("30-item batch validates", batch30.every((payload) => syncPayloadSchema.safeParse(payload).success));

for (const needle of [
  "There are only two business outcomes: no conversation history = not_sent, any conversation history = sent.",
  "A search result by itself is not proof of conversation history.",
  "If there is no message history, submit not_sent",
  "If there is at least one message in the conversation",
  "regardless of whether it was sent by us or received from them",
  "do not submit uncertain",
]) check(`prompt policy ${needle}`, promptSource.includes(needle));

for (const forbidden of [
  "Compare against that exact text",
  "The newest outgoing message is not automatically the approved DM",
  "evidence.direction",
  "evidence.currentAttempt",
]) check(`legacy exact-message rule removed: ${forbidden}`, !promptSource.includes(forbidden));

check("producer sent schema has no evidence requirement",
  toolSource.includes('z.object({ ...syncContactFields, status: z.literal("sent") })')
  && !toolSource.includes('direction: z.literal("outgoing")')
  && !toolSource.includes('currentAttempt: z.literal("yes")'));
check("server sent schema has no evidence requirement",
  serverSource.includes('z.object({ ...contactFields, status: z.literal("sent") })')
  && !serverSource.includes('isConfirmedSentEvidence'));

check("not_sent uses existing final verification return flow",
  serverSource.includes('returnDmContactsToFinalVerification(')
  && serverSource.includes('destination: "final_verification"'));
check("sent uses existing sent save flow",
  serverSource.includes('markDmContactSentFromSync(')
  && serverSource.includes('destination: "dm_ready"'));
check("uncertain does not mutate state",
  serverSource.includes('destination: "send_confirmation"')
  && serverSource.includes('changed: false'));

check("existing final verification function is reused",
  contactsSource.includes("export async function returnDmContactsToFinalVerification"));
check("final verification return keeps candidate verification status untouched",
  !contactsSource.slice(contactsSource.indexOf("export async function returnDmContactsToFinalVerification"), contactsSource.indexOf("export async function markDmContactSentFromSync")).includes('.from("creator_candidates")\n    .update('));
check("sent save still only sets sent_at",
  contactsSource.includes('.update({ sent_at: new Date().toISOString() })'));

check("exit=0 incomplete can fallback",
  launcherSource.includes('$FallbackAllowed = $Code -in @(0,173,174,175,176,179)')
  && launcherSource.includes('"incomplete_result"'));
check("browser/tool exits can fallback",
  launcherSource.includes('elseif ($Code -eq 176) { "browser_unavailable" }')
  && launcherSource.includes('elseif ($Code -eq 179) { "tool_execution" }'));
check("inbox unavailable marker classified",
  promptSource.includes("FIXUP_DM_SYNC_INBOX_UNAVAILABLE")
  && wrapperSource.includes("FIXUP_LOCAL_browser_unavailable dm_sync_inbox_not_ready"));
check("stale ref recovery remains bounded",
  promptSource.includes("retry that intended action exactly once")
  && launcherSource.includes("retrySameModel"));
check("provider transient retry remains",
  launcherSource.includes("RetryDelaySeconds = 10"));
check("OpenCode free-tier restriction skips pointless retry",
  launcherSource.includes("PersistentProviderRestriction"));

check("progress parser still records sent/not_sent",
  progressSource.includes('resultStatus === "sent"') && progressSource.includes('resultStatus === "not_sent"'));

let posted = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  posted = JSON.parse(String(init?.body ?? "null"));
  return new Response(JSON.stringify({ ok: true, changed: true }), { status: 200 });
};
try {
  const receipt = await sync.execute({ payload: sent }, { agent: "fixup-dm-sync" });
  check("sent tool POST accepts evidence-free payload", posted?.status === "sent" && receipt.includes('"ok":true'), JSON.stringify(posted));
} finally {
  globalThis.fetch = originalFetch;
}

const failed = cases.filter(([, ok]) => !ok);
for (const [name, ok, detail] of cases) console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
console.log(`dm-sync regression: ${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) process.exit(1);
