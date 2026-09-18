import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const passed = [];

function ok(name, condition) {
  assert.ok(condition, name);
  passed.push(name);
}

function loadTs(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const source = require("node:fs").readFileSync(filename, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id);
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${js}\n})`, { filename })(
    localRequire, module, module.exports, filename, path.dirname(filename),
  );
  return module.exports;
}

const instagramMock = {
  normalizeHandle: (value) => String(value ?? "").trim().replace(/^@/, "").toLowerCase(),
  isValidHandle: (value) => /^[a-z0-9._]{1,30}$/.test(String(value)),
};
const metricsMock = {
  computeReelMetrics: (reels) => ({
    average: null, median: null, sampleSize: 0, checkedCount: 0,
    totalConsidered: reels.length, status: "insufficient", snapshots: reels,
  }),
};
const decisionMock = {
  decideVerification: () => ({
    reason: "deterministic test", verificationStatus: "verified", discoveryStatus: "qualified",
  }),
};

function makeVerificationSupabase(candidateRows) {
  const updates = [];
  let contactedReads = 0;
  return {
    updates,
    get contactedReads() { return contactedReads; },
    client: {
      from(table) {
        if (table === "creator_contacted_handles") {
          contactedReads += 1;
          throw new Error("contacted history must not be read by verification save");
        }
        assert.equal(table, "creator_candidates");
        return {
          select() { return { eq() { return { in: async () => ({ data: candidateRows, error: null }) }; } }; },
          update(patch) { updates.push(patch); return { eq() { return { eq: async () => ({ error: null }) }; } }; },
        };
      },
    },
  };
}

function verificationModule(fake) {
  return loadTs("src/lib/supabase/verification.ts", {
    "@/lib/discovery/instagram": instagramMock,
    "@/lib/verification/decision": decisionMock,
    "@/lib/verification/metrics": metricsMock,
    "./admin": { getSupabaseAdmin: () => fake.client },
  });
}

const contactedHistory = [{ handle: "contacted_one", immutable: true }];
const contactedBefore = JSON.stringify(contactedHistory);
const verificationFake = makeVerificationSupabase([{
  normalized_handle: "contacted_one", followers: 12000,
  followers_source: "instagram", discovery_status: "search_qualified",
}]);
const { applyInstagramVerificationResults } = verificationModule(verificationFake);
const result = await applyInstagramVerificationResults("beauty", [{
  handle: "contacted_one", duplicateStatus: "available", duplicateMessage: null,
  exists: true, isPrivate: false, isPersonalCreator: true, bio: "creator",
  followers: 12000, recentActivity: true, lastActivityAt: null,
  japaneseTarget: true, koreaConnection: true, categoryRelevant: true,
  creatorSignals: ["personal creator"], targetSignals: ["Japanese"],
  koreaSignals: ["Korea"], categorySignals: ["beauty"], reels: [], note: null,
}]);
ok("contacted candidate result updates exactly once", result.updated === 1 && result.ignored === 0);
ok("verification never reads contacted history", verificationFake.contactedReads === 0);
ok("contacted history sentinel remains unchanged", JSON.stringify(contactedHistory) === contactedBefore);
ok("verification candidate row receives one update", verificationFake.updates.length === 1);

const missingFake = makeVerificationSupabase([]);
const missingModule = verificationModule(missingFake);
await assert.rejects(
  () => missingModule.applyInstagramVerificationResults("beauty", [{
    handle: "missing_creator", duplicateStatus: "available", duplicateMessage: null,
    exists: true, isPrivate: false, isPersonalCreator: true, bio: null,
    followers: 9000, recentActivity: true, lastActivityAt: null,
    japaneseTarget: true, koreaConnection: true, categoryRelevant: true,
    creatorSignals: ["creator"], targetSignals: ["jp"], koreaSignals: ["kr"],
    categorySignals: ["beauty"], reels: [], note: null,
  }]),
  /Verification candidates not found/,
);
passed.push("missing verification candidate fails explicitly");

function makeProgressSupabase(jobRow) {
  const updates = [];
  return {
    updates,
    client: {
      from(table) {
        assert.equal(table, "creator_verification_jobs");
        return {
          select() { return { eq() { return { single: async () => ({ data: jobRow, error: null }) }; } }; },
          update(patch) { updates.push(patch); return { eq() { return { eq: async () => ({ error: null }) }; } }; },
        };
      },
    },
  };
}
