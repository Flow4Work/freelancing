import fs from "node:fs";
import path from "node:path";
import { loadTsModule } from "./fixup-ts-module-loader.mjs";

const root = process.cwd();
const toolPath = path.join(root, ".opencode", "tools", "fixup_result.ts");
const contractPath = path.join(root, "src", "lib", "verification", "result-contract.ts");
const { verification } = loadTsModule(toolPath);
const { verificationPayloadSchema } = loadTsModule(contractPath);
if (!verification?.execute || !verificationPayloadSchema) throw new Error("verification contract exports unavailable");

const capturedCanonical = {
  jobId: "3e8ab2a9-4760-485b-a711-1864887d8951",
  category: "beauty",
  results: [{
    handle: "akieshi", duplicateStatus: "available",
    duplicateMessage: "등록 가능한 인플루언서입니다 / 登録可能なインフルエンサーです: @akieshi",
    exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "Freelance Hair & Makeup Artist", followers: 3955,
    recentActivity: true, lastActivityAt: "2026-07-24",
    japaneseTarget: true, koreaConnection: false, categoryRelevant: true,
    creatorSignals: ["개인 creator 근거"], targetSignals: ["일본어 발신"],
    koreaSignals: [], categorySignals: ["뷰티 콘텐츠"], reels: [],
    note: "한국 접점 근거 없음으로 hard reject, Reels 미확인",
  }],
};
const capturedSerialized = JSON.stringify(capturedCanonical);
const cases = [];
const check = (name, ok, detail = "") => cases.push([name, Boolean(ok), detail]);
check("canonical object payload parses", verificationPayloadSchema.safeParse(capturedCanonical).success);
const nullSignals = structuredClone(capturedCanonical);
nullSignals.results[0].creatorSignals = null;
nullSignals.results[0].targetSignals = null;
nullSignals.results[0].koreaSignals = null;
nullSignals.results[0].categorySignals = null;
const normalizedSignals = verificationPayloadSchema.safeParse(nullSignals);
check("legacy null signal arrays normalize at the shared boundary", normalizedSignals.success && normalizedSignals.data.results[0].creatorSignals.length === 0 && normalizedSignals.data.results[0].targetSignals.length === 0 && normalizedSignals.data.results[0].koreaSignals.length === 0 && normalizedSignals.data.results[0].categorySignals.length === 0);
check("captured serialized payload is rejected", !verificationPayloadSchema.safeParse(capturedSerialized).success);
check("malformed string is rejected", !verificationPayloadSchema.safeParse("{bad json").success);
check("JSON primitive string is rejected", !verificationPayloadSchema.safeParse("true").success);
check("array payload is rejected", !verificationPayloadSchema.safeParse([capturedCanonical]).success);
check("required jobId missing is rejected", !verificationPayloadSchema.safeParse({
  category: capturedCanonical.category, results: capturedCanonical.results,
}).success);

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network must not be reached"); };
let capturedError = "";
try {
  await verification.execute({ payload: capturedSerialized }, { agent: "fixup-verification" });
} catch (error) {
  capturedError = String(error);
}
check(
  "old OpenCode serialized tool call fails before HTTP",
  fetchCalls === 0 && capturedError.includes("FIXUP_TOOL_VALIDATION_FAILED") && capturedError.includes("expected object"),
  `fetchCalls=${fetchCalls} error=${capturedError}`,
);
globalThis.fetch = originalFetch;

let postedBody = null;
let postedUrl = null;
globalThis.fetch = async (url, init) => {
  fetchCalls += 1;
  postedUrl = String(url);
  postedBody = JSON.parse(String(init?.body ?? "null"));
  return new Response(JSON.stringify({ ok: true, processedCount: 1, totalCount: 30, completed: false }), { status: 200 });
};
let successReceipt = "";
try {
  successReceipt = await verification.execute({ payload: capturedCanonical }, { agent: "fixup-verification" });
} finally {
  globalThis.fetch = originalFetch;
}
check("canonical object reaches fixed verification endpoint", postedUrl === "http://localhost:3000/api/verification/results", postedUrl);
check("HTTP transport serializes canonical object once", JSON.stringify(postedBody) === JSON.stringify(capturedCanonical), JSON.stringify(postedBody));
check("successful POST receipt is returned", successReceipt.includes('"ok":true') && successReceipt.includes('"processedCount":1'), successReceipt);

const promptSource = fs.readFileSync(path.join(root, "src", "lib", "discovery", "opencode-prompt.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src", "app", "api", "verification", "results", "route.ts"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "src", "lib", "supabase", "verification.ts"), "utf8");
const toolSource = fs.readFileSync(toolPath, "utf8");
check("prompt requires structured payload object", promptSource.includes("payload is a structured tool argument object") && promptSource.includes('never send {payload: "{...}"}'));
check("prompt has no stale same-origin browser fetch save rule", !promptSource.includes("same-origin playwright_b fetch method"));
check("tool uses canonical verification schema", toolSource.includes('verificationPayloadSchema') && toolSource.includes('submit("fixup-verification", "/api/verification/results", verificationPayloadSchema)'));
check("API route uses canonical verification schema", routeSource.includes('verificationPayloadSchema.safeParse') && !routeSource.includes('const bodySchema =') && !routeSource.includes('const resultSchema ='));
check("persistence consumes canonical inferred result type", persistenceSource.includes('import type { InstagramVerificationResult } from "@/lib/verification/result-contract"') && !persistenceSource.includes('export type InstagramVerificationResult = {'));

const failed = cases.filter(([, ok]) => !ok);
for (const [name, ok, detail] of cases) console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
console.log(`verification-contract: ${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) process.exit(1);
