import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const passed = [];
const ok = (name, condition) => { assert.ok(condition, name); passed.push(name); };

function loadTs(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id);
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${js}\n})`, { filename })(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const policyMock = {
  MIN_TARGET_FOLLOWERS: 3000,
  MAX_TARGET_FOLLOWERS_EXCLUSIVE: 100000,
  getFollowerPolicyRejection: (_category, followers) => followers == null ? null : followers < 3000 ? "under_min" : followers >= 100000 ? "over_max" : null,
};
const decision = loadTs("src/lib/verification/decision.ts", {
  "@/lib/discovery/quality": { hasStrongKoreaAccess: () => false, hasActualKBeautyContent: () => false },
  "./policy": policyMock,
});
const insufficientMetrics = { average: null, median: null, sampleSize: 0, checkedCount: 0, totalConsidered: 0, status: "insufficient", snapshots: [] };
const readyMetrics = { average: 6000, median: 6000, sampleSize: 5, checkedCount: 5, totalConsidered: 5, status: "ready", snapshots: [] };
const base = {
  category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false,
  isPersonalCreator: true, bio: "개인 뷰티 크리에이터", followers: 12000,
  recentActivity: true, japaneseTarget: true, koreaConnection: true, categoryRelevant: true,
  creatorSignals: ["개인 리뷰"], targetSignals: ["일본어 발신"], koreaSignals: ["한국 거주"], categorySignals: ["한국 화장품 사용 리뷰"],
  reelMetrics: readyMetrics, note: null,
};

ok("confirmed business account rejects", decision.decideVerification({ ...base, isPersonalCreator: false }).verificationStatus === "rejected");
ok("confirmed policy mismatch rejects", decision.decideVerification({ ...base, japaneseTarget: false }).verificationStatus === "rejected");
ok("Reels loading failure stays insufficient", decision.decideVerification({ ...base, reelMetrics: insufficientMetrics, note: "Reels 로딩 실패로 조회수 확인 불가" }).verificationStatus === "insufficient");
ok("partial verification stays insufficient", decision.decideVerification({ ...base, exists: null, reelMetrics: insufficientMetrics }).verificationStatus === "insufficient");
const smallFailed = decision.decideVerification({ ...base, followers: 2638, reelMetrics: insufficientMetrics, note: "소규모 크리에이터 예외 충족하나 Reels 목록 화면에서 조회수 확인 불가로 reels 확인 실패" });
ok("under-3K exception plus Reels failure is review", smallFailed.verificationStatus === "insufficient" && smallFailed.discoveryStatus === "needs_review");
const presentation = loadTs("src/lib/discovery/presentation.ts", {
  "@/lib/verification/policy": policyMock,
  "./classification": { classifySearchStage: () => "search_qualified" },
  "./recommendation": { getRecommendationAssessment: () => ({ tier: "recommended" }) },
});
const candidateBase = {
  category: "beauty", candidateStatus: "qualified", duplicateCheckStatus: "available",
  verificationStatus: "verified", followers: 12000, followersSource: "instagram",
  accountAvailability: "active", accountType: "creator", koreaAffinity: "yes", contentFit: "beauty", eligibility: "possible",
};
ok("verified candidate goes final verification", presentation.getCandidateViewState(candidateBase) === "final_verification");
ok("legitimate rejected candidate is excluded", presentation.getCandidateViewState({ ...candidateBase, verificationStatus: "rejected" }) === "unmapped");
ok("available incomplete under-min candidate remains visible", presentation.getCandidateViewState({ ...candidateBase, candidateStatus: "needs_review", verificationStatus: "insufficient", followers: 2638, eligibility: "unknown" }) === "duplicate_passed");

const verificationContract = fs.readFileSync(path.join(root, "src/lib/verification/result-contract.ts"), "utf8");
const verificationPrompt = fs.readFileSync(path.join(root, "src/lib/discovery/opencode-prompt.ts"), "utf8");
const verificationSave = fs.readFileSync(path.join(root, "src/lib/supabase/verification.ts"), "utf8");
ok("null signal arrays normalize to empty arrays", verificationContract.includes("value == null ? [] : value") && verificationContract.includes("optionalVerificationSignalArraySchema"));
ok("verification prompt forbids null signal arrays", verificationPrompt.includes("절대 null을 보내지 않는다"));
ok("unknown recent activity stays null", verificationPrompt.includes("recentActivity와 lastActivityAt을 모두 null") && verificationPrompt.includes("false로 추정하지 않는다"));
ok("duplicate available is preserved by verification save", verificationSave.includes("duplicate_check_status: result.duplicateStatus"));
const syncPrompt = fs.readFileSync(path.join(root, "src/lib/dm/sync-prompt.ts"), "utf8");
for (const [name, needle] of [
  ["Profile 3 preflight", 'first browser call must be playwright_b_browser_tabs with action:"list"'],
  ["relay preserved", "Preserve every chrome-extension://.../connect.html relay tab"],
  ["existing inbox reused", "If an Instagram Direct inbox tab already exists, select and reuse that tab"],
  ["relay-only gets new work tab", 'browser_tabs action:"new", url:"https://www.instagram.com/direct/inbox/"'],
  ["browser unavailable stops", "tabs list itself reports browser/context unavailable, stop"],
  ["DM send remains forbidden", "Never send a message"],
]) ok(`dm-sync lifecycle ${name}`, syncPrompt.includes(needle));

console.log(`PASS verification-state regression ${passed.length}/${passed.length}`);
for (const name of passed) console.log(`PASS ${name}`);
