import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const sourcePath = path.join(root, "src/lib/automation/history-order.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const moduleShim = { exports: {} };
new Function("require", "module", "exports", compiled)(require, moduleShim, moduleShim.exports);
const { sortByEventTimestampDesc, eventTimestampEpoch } = moduleShim.exports;
assert.ok(sortByEventTimestampDesc && eventTimestampEpoch, "history order exports unavailable");

const entries = [
  { name: "9/15 15:43", timestamp: "2026-09-15T15:43:00+09:00" },
  { name: "9/15 23:43", timestamp: "2026-09-15T23:43:00+09:00" },
  { name: "9/15 23:54", timestamp: "2026-09-15T23:54:00+09:00" },
  { name: "9/16 00:14", timestamp: "2026-09-16T00:14:00+09:00" },
  { name: "9/15 23:55", timestamp: "2026-09-15T23:55:00+09:00" },
];
const ordered = sortByEventTimestampDesc(entries).map((entry) => entry.name);
assert.deepEqual(ordered, ["9/16 00:14", "9/15 23:55", "9/15 23:54", "9/15 23:43", "9/15 15:43"], "history order must be epoch-descending across midnight");
assert.ok(eventTimestampEpoch("2026-09-16T00:14:00+09:00") > eventTimestampEpoch("2026-09-15T23:55:00+09:00"), "midnight boundary ordering failed");
assert.equal(sortByEventTimestampDesc([{ name: "invalid", timestamp: null }, ...entries]).at(-1)?.name, "invalid", "missing timestamp must sort last");

const component = fs.readFileSync(path.join(root, "src/components/discovery-console.tsx"), "utf8");
for (const needle of ["const processingHistory = buildProcessingHistory(historyItems, dmSyncStatus)", "processingHistory.map", "sortByEventTimestampDesc(entries)", "sync.updatedAt ?? sync.startedAt", "item.failedAt ?? item.createdAt", "item.completedAt ?? item.createdAt"]) {
  assert.ok(component.includes(needle), `history UI epoch feed missing: ${needle}`);
}
assert.ok(!component.includes('{dmSyncStatus && dmSyncStatus.status !== "idle" && ('), "dmSyncStatus must not be pinned above sorted history");
console.log("PASS history timestamp regression");
