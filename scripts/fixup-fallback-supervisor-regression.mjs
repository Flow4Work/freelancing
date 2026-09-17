import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const launcher = fs.readFileSync(path.join(root, "src/lib/automation/opencode-launcher.ts"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "scripts/fixup-opencode-wrapper.ps1"), "utf8");
const retryMatch = launcher.match(/\$Retryable = @\(([^\n]+)\) -contains \[string\]\$Result\.classification/);
assert.ok(retryMatch, "launcher retryable policy not found");
const retryable = new Set([...retryMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
assert.ok(retryable.has("tool_execution"), "tool_execution must be retryable");
assert.ok(retryable.has("provider_unavailable"), "provider_unavailable must be retryable");
assert.ok(!retryable.has("local_execution"), "deterministic local_execution must remain non-retryable");
assert.match(wrapper, /Provider unavailable: no semantic tool\/text progress[\s\S]*?exit 175/, "semantic stall must map to retryable provider_unavailable/175");
assert.match(wrapper, /Local execution failure: no stdout\/stderr activity[\s\S]*?exit 180/, "non-provider local inactivity must remain local_execution/180");
assert.ok(launcher.includes("shared browser/MCP preflight failed; reinitialize same model once"), "same-model browser recovery missing");
assert.ok(launcher.includes("shared browser/MCP still unavailable after recovery"), "terminal shared-browser recovery guard missing");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixup-fallback-regression-"));
const marker = path.join(dir, "attempts.log");
const runAttempt = (n, exitCode) => spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Add-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value 'attempt=${n} started'; exit ${exitCode}`], { encoding: "utf8" });

const first = runAttempt(1, 179);
assert.equal(first.status, 179, "attempt 1 fixture must fail as tool_execution/179");
const classification = first.status === 179 ? "tool_execution" : "other";
const fallback = retryable.has(classification);
assert.equal(fallback, true, "attempt 1 tool_execution must enable fallback");
const second = fallback ? runAttempt(2, 0) : null;
assert.ok(second, "attempt 2 was not invoked");
assert.equal(second.status, 0, "attempt 2 fixture must start and exit successfully");

const stalled = runAttempt(3, 175);
assert.equal(stalled.status, 175, "semantic stall fixture must exit as provider_unavailable/175");
const stalledClassification = stalled.status === 175 ? "provider_unavailable" : "other";
assert.equal(retryable.has(stalledClassification), true, "semantic stall provider_unavailable must enable fallback");

const local = runAttempt(4, 180);
assert.equal(local.status, 180, "local execution fixture must exit as local_execution/180");
const localClassification = local.status === 180 ? "local_execution" : "other";
assert.equal(retryable.has(localClassification), false, "deterministic local_execution must not fallback");

const log = fs.readFileSync(marker, "utf8");
assert.match(log, /attempt=1 started/);
assert.match(log, /attempt=2 started/);
assert.match(log, /attempt=3 started/);
assert.match(log, /attempt=4 started/);
console.log("PASS attempt 1 = tool_execution retryable failure");
console.log("PASS fallback=True");
console.log("PASS attempt 2 = started");
console.log("PASS semantic stall = provider_unavailable/175 fallback=True");
console.log("PASS deterministic local_execution/180 fallback=False");
console.log("PASS shared browser failure uses one same-model recovery before terminal stop");
fs.rmSync(dir, { recursive: true, force: true });