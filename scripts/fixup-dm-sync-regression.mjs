import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { loadTsModule } from "./fixup-ts-module-loader.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const toolPath = path.join(root, ".opencode", "tools", "fixup_result.ts");
const toolSource = fs.readFileSync(toolPath, "utf8");
const { syncPayloadSchema, sync } = loadTsModule(toolPath);
if (!syncPayloadSchema || !sync?.execute) throw new Error("sync tool exports unavailable");
const sentSyncPath = path.join(root, "src", "lib", "dm", "sent-sync.ts");
const sentSyncCompiled = ts.transpileModule(fs.readFileSync(sentSyncPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sentSyncShim = { exports: {} };
new Function("require", "module", "exports", sentSyncCompiled)(require, sentSyncShim, sentSyncShim.exports);
const { isConfirmedSentEvidence, normalizeInstagramDmExactText } = sentSyncShim.exports;
if (!isConfirmedSentEvidence || !normalizeInstagramDmExactText) throw new Error("sent-sync exports unavailable");

const A = { contactId: "fc0f76c4-5d9b-422e-b50c-2d7ff6608bc6", handle: "nagi_30life_", status: "sent", evidence: { text: "test" } };
const B = { contactId: "fc9a586c-472b-45de-af18-c553a7944942", handle: "ayani0625", status: "sent", evidence: { text: "test" } };
const validSent = { contactId: B.contactId, handle: B.handle, status: "sent", evidence: { text: "test", direction: "outgoing", currentAttempt: "yes" } };
const validNotSent = { contactId: "40ec8c61-3b29-40a8-8832-92b6db0104d0", handle: "118mayuyu", status: "not_sent" };
const validUncertain = { contactId: B.contactId, handle: B.handle, status: "uncertain", error: "cannot confirm current attempt" };

const cases = [];
function expectParse(name, payload, expected) {
  const actual = syncPayloadSchema.safeParse(payload).success;
  cases.push([name, actual === expected, actual]);
}
expectParse("captured A malformed sent", A, false);
expectParse("captured B malformed sent", B, false);
expectParse("valid sent", validSent, true);
expectParse("valid not_sent", validNotSent, true);
expectParse("valid uncertain", validUncertain, true);
expectParse("incoming", { ...validSent, evidence: { ...validSent.evidence, direction: "incoming" } }, false);
expectParse("unknown direction", { ...validSent, evidence: { ...validSent.evidence, direction: "unknown" } }, false);
expectParse("currentAttempt=no", { ...validSent, evidence: { ...validSent.evidence, currentAttempt: "no" } }, false);
expectParse("currentAttempt=unknown", { ...validSent, evidence: { ...validSent.evidence, currentAttempt: "unknown" } }, false);
expectParse("missing evidence", { contactId: B.contactId, handle: B.handle, status: "sent" }, false);
expectParse("invalid contactId UUID", { ...validSent, contactId: "not-a-uuid" }, false);
expectParse("invalid handle", { ...validSent, handle: "bad..handle" }, false);
expectParse("unknown status is not promoted", { contactId: B.contactId, handle: B.handle, status: "unknown" }, false);

const batch30 = Array.from({ length: 30 }, (_, index) => ({
  contactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  handle: `batchtest${index + 1}`,
  status: "not_sent",
}));
const batch30Results = batch30.map((payload) => syncPayloadSchema.safeParse(payload).success);
cases.push(["30-item batch validates 30/30", batch30Results.every(Boolean), batch30Results.filter(Boolean).length]);
const batchOneInvalid = batch30.map((payload, index) => index === 12
  ? { ...payload, status: "sent", evidence: { text: "test" } }
  : payload);
const batchOneInvalidResults = batchOneInvalid.map((payload) => syncPayloadSchema.safeParse(payload).success);
cases.push(["30-item batch keeps exactly one invalid", batchOneInvalidResults.filter(Boolean).length === 29 && batchOneInvalidResults[12] === false, batchOneInvalidResults.filter(Boolean).length]);

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network must not be reached"); };
for (const [name, payload] of [["captured A pre-HTTP", A], ["captured B pre-HTTP", B]]) {
  let blocked = false;
  let detail = "";
  try {
    await sync.execute({ payload }, { agent: "fixup-dm-sync" });
  } catch (error) {
    detail = String(error);
    blocked = detail.includes("FIXUP_TOOL_VALIDATION_FAILED")
      && detail.includes("evidence.direction")
      && detail.includes("evidence.currentAttempt");
  }
  cases.push([name, blocked && fetchCalls === 0, `blocked=${blocked}, fetchCalls=${fetchCalls}, detail=${detail}`]);
}
globalThis.fetch = originalFetch;
const promptSource = fs.readFileSync(path.join(root, "src", "lib", "dm", "sync-prompt.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "src", "app", "api", "dm", "sync-result", "route.ts"), "utf8");
const sentSyncSource = fs.readFileSync(path.join(root, "src", "lib", "dm", "sent-sync.ts"), "utf8");
const progressSource = fs.readFileSync(path.join(root, "src", "app", "api", "dm", "sync", "route.ts"), "utf8");

for (const needle of ['"direction": "outgoing"', '"currentAttempt": "yes"', 'evidence.text alone is invalid']) {
  cases.push([`prompt contract ${needle}`, promptSource.includes(needle), promptSource.includes(needle)]);
}
for (const needle of ['z.literal("sent")', 'z.literal("not_sent")', 'z.literal("uncertain")', 'direction: z.literal("outgoing")', 'currentAttempt: z.literal("yes")']) {
  cases.push([`producer/server contract ${needle}`, toolSource.includes(needle) && serverSource.includes(needle), `producer=${toolSource.includes(needle)}, server=${serverSource.includes(needle)}`]);
}
for (const needle of ['dm_sent_sync_result_invalid', 'issues: parsed.error.issues.map', 'issue.path.join(".")', 'error: "invalid DM sync result", validation']) {
  cases.push([`server validation diagnostics ${needle}`, serverSource.includes(needle), serverSource.includes(needle)]);
}
for (const needle of ['message.direction === "outgoing"', 'message.currentAttempt === "yes"', 'normalizeInstagramDmExactText(message.text) === approved']) {
  cases.push([`sent evidence policy ${needle}`, sentSyncSource.includes(needle), sentSyncSource.includes(needle)]);
}
for (const needle of [
  "approvedJapaneseText,",
  "The newest outgoing message is not automatically the approved DM",
  "Never use the follow-up itself as sent evidence",
  "If ambiguous, use uncertain",
  "An incoming bubble that matches approvedJapaneseText is never sent evidence",
]) {
  cases.push([`approved DM prompt policy ${needle}`, promptSource.includes(needle), promptSource.includes(needle)]);
}
const approved = "????????????\n????DM???";
const followup = "?????????????";
cases.push([
  "approved exact outgoing can be sent",
  isConfirmedSentEvidence(approved, [{ text: approved, direction: "outgoing", currentAttempt: "yes" }]) === true,
  "exact approved outgoing",
]);
cases.push([
  "follow-up cannot be sent evidence",
  isConfirmedSentEvidence(approved, [{ text: followup, direction: "outgoing", currentAttempt: "yes" }]) === false,
  "mismatched follow-up",
]);
cases.push([
  "incoming exact text cannot be sent",
  isConfirmedSentEvidence(approved, [{ text: approved, direction: "incoming", currentAttempt: "yes" }]) === false,
  "incoming exact",
]);
cases.push([
  "missing current attempt cannot be sent",
  isConfirmedSentEvidence(approved, [{ text: approved, direction: "outgoing", currentAttempt: "unknown" }]) === false,
  "currentAttempt unknown",
]);
cases.push([
  "older approved bubble survives newer follow-up when current attempt proven",
  isConfirmedSentEvidence(approved, [
    { text: followup, direction: "outgoing", currentAttempt: "yes" },
    { text: approved, direction: "outgoing", currentAttempt: "yes" },
  ]) === true,
  "approved bubble plus newer follow-up",
]);
cases.push([
  "exact normalization keeps whitespace policy",
  isConfirmedSentEvidence("A\nB", [{ text: " A   B ", direction: "outgoing", currentAttempt: "yes" }]) === true
    && normalizeInstagramDmExactText("A\r\nB") === normalizeInstagramDmExactText("A B"),
  "whitespace normalization",
]);
cases.push(["progress parser tolerates evidence fields", progressSource.includes("event?.part?.state?.input?.payload?.status"), progressSource.includes("event?.part?.state?.input?.payload?.status")]);

let failed = 0;
for (const [name, ok, detail] of cases) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` (${detail})`}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`PASS dm-sync regression ${cases.length}/${cases.length}`);
