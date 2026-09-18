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
assert.ok(retryable.has("browser_unavailable"), "browser_unavailable must be retryable");
assert.ok(retryable.has("provider_unavailable"), "provider_unavailable must be retryable");
assert.ok(retryable.has("incomplete"), "incomplete result must be retryable");
assert.ok(!retryable.has("local_execution"), "deterministic local_execution must remain non-retryable");
assert.match(wrapper, /Provider unavailable: no semantic tool\/text progress[\s\S]*?exit 175/, "semantic stall must map to retryable provider_unavailable/175");
assert.match(wrapper, /Local execution failure: no stdout\/stderr activity[\s\S]*?exit 180/, "non-provider local inactivity must remain local_execution/180");
assert.ok(launcher.includes('$SameModelRetryDelay = 10'), "transient provider/rate-limit same-model 10s retry missing");
assert.ok(launcher.includes('$Result.classification -in @("browser_unavailable", "tool_execution", "incomplete")'), "local/browser/incomplete same-model retry missing");
assert.ok(launcher.includes('[string]$Result.detail -notmatch "free-tier automation access rejected"'), "persistent OpenCode 403 must skip same-model retry");
assert.ok(!launcher.includes("shared playwright_b/Profile 3 browser/MCP recovery failed"), "browser recovery must fallback instead of terminal throw");
assert.match(wrapper, /OpenCode''s free tier can only be used from within OpenCode/, "OpenCode free-tier 403 restriction must be classified as provider_unavailable");
assert.ok(launcher.includes("OpenCode free-tier automation access rejected (403)"), "launcher must preserve the real OpenCode free-tier 403 reason");
assert.ok(launcher.includes("provider_unavailable") && retryable.has("provider_unavailable"), "provider restriction must continue to the next fallback model");
assert.ok(launcher.includes("browser_snapshot({})") && launcher.includes("두 번째 stale ref/actionability timeout"), "verification prompt must require bounded fresh-snapshot recovery");

function extractPsFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `PowerShell function ${name} not found`);
  return source.slice(start, end);
}

function runPowerShell(source) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
}

const providerFn = extractPsFunction(wrapper, "Test-ProviderUnavailable", "Test-ProviderRateLimit");
const providerProbe = runPowerShell(`${providerFn}
if (Test-ProviderUnavailable "AI_APICallError: Error from provider (Console): OpenCode's free tier can only be used from within OpenCode") { Write-Output "provider_unavailable" } else { Write-Output "other" }`);
assert.equal(providerProbe.status, 0, providerProbe.stderr);
assert.match(providerProbe.stdout, /provider_unavailable/, "OpenCode 403 restriction must be retryable provider_unavailable");

const recoverableFn = extractPsFunction(wrapper, "Test-RecoverableBrowserToolFailure", "Get-OpenCodeErrorSignal");
const signalFn = extractPsFunction(wrapper, "Get-OpenCodeErrorSignal", "Test-LocalBrowserRuntimeFailure");
const staleEvent = JSON.stringify({
  type: "tool_use",
  part: {
    tool: "playwright_b_browser_snapshot",
    state: {
      status: "error",
      error: "### Error\\nError: Ref f1e150 not found in the current page snapshot. Try capturing new snapshot.",
      output: "",
    },
  },
});
const staleEvent2 = JSON.stringify({
  type: "tool_use",
  part: {
    tool: "playwright_b_browser_click",
    state: {
      status: "error",
      error: "### Error\\nError: Ref f13e142 not found in the current page snapshot. Try capturing new snapshot.",
      output: "",
    },
  },
});
const oneStale = Buffer.from(staleEvent, "utf8").toString("base64");
const twoStale = Buffer.from(`${staleEvent}\n${staleEvent2}`, "utf8").toString("base64");
const recoveryProbe = runPowerShell(`${recoverableFn}
${signalFn}
$env:FIXUP_SCOUT_AGENT = 'fixup-verification'
$one = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${oneStale}'))
$two = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${twoStale}'))
$clickDetail = "TimeoutError: browserBackend.callTool: Timeout 5000ms exceeded. - waiting for locator('aria-ref=f10e331') - locator resolved to <a role='link'>x</a> - attempting click action - waiting for element to be visible, enabled and stable"
Write-Output ('CLICK=' + (Test-RecoverableBrowserToolFailure 'playwright_b_browser_click' $clickDetail))
Write-Output ('ONE=' + (Get-OpenCodeErrorSignal $one ''))
Write-Output ('TWO=' + (Get-OpenCodeErrorSignal $two ''))
`);
assert.equal(recoveryProbe.status, 0, recoveryProbe.stderr);
const clickLine = recoveryProbe.stdout.split(/\r?\n/).find((line) => line.startsWith("CLICK=")) ?? "";
const oneLine = recoveryProbe.stdout.split(/\r?\n/).find((line) => line.startsWith("ONE=")) ?? "";
const twoStart = recoveryProbe.stdout.indexOf("TWO=");
const twoBlock = twoStart >= 0 ? recoveryProbe.stdout.slice(twoStart) : "";
assert.match(clickLine, /CLICK=True/i, "verification click actionability timeout must be recoverable once");
assert.match(oneLine, /FIXUP_RECOVERABLE_browser_tool/, "first stale ref must remain inside the same verification attempt");
assert.doesNotMatch(oneLine, /FIXUP_LOCAL_tool_execution/, "first stale ref must not immediately kill the attempt");
assert.match(twoBlock, /FIXUP_LOCAL_tool_execution/, "second recoverable browser failure must terminate the attempt for fallback");

const dmSyncMarkerEvent = JSON.stringify({
  type: "text",
  part: { text: "FIXUP_DM_SYNC_INBOX_UNAVAILABLE" },
});
const dmSyncStaleEvent = Buffer.from(staleEvent, "utf8").toString("base64");
const dmSyncMarker = Buffer.from(dmSyncMarkerEvent, "utf8").toString("base64");
const dmSyncProbe = runPowerShell(`${recoverableFn}
${signalFn}
$env:FIXUP_SCOUT_AGENT = 'fixup-dm-sync'
$marker = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${dmSyncMarker}'))
$stale = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${dmSyncStaleEvent}'))
Write-Output ('MARKER=' + (Get-OpenCodeErrorSignal $marker ''))
Write-Output ('STALE=' + (Get-OpenCodeErrorSignal $stale ''))
`);
assert.equal(dmSyncProbe.status, 0, dmSyncProbe.stderr);
const markerLine = dmSyncProbe.stdout.split(/\r?\n/).find((line) => line.startsWith("MARKER=")) ?? "";
const dmSyncStaleLine = dmSyncProbe.stdout.split(/\r?\n/).find((line) => line.startsWith("STALE=")) ?? "";
assert.match(markerLine, /FIXUP_LOCAL_browser_unavailable dm_sync_inbox_not_ready/, "dm-sync inbox readiness marker must map to browser_unavailable");
assert.match(dmSyncStaleLine, /FIXUP_RECOVERABLE_browser_tool/, "dm-sync first stale ref must be recoverable once");

const validationEvent = JSON.stringify({
  type: "tool_use",
  part: {
    tool: "fixup_result_verification",
    state: {
      status: "error",
      error: "FIXUP_POST_FAILED /api/verification/results: FIXUP_TOOL_VALIDATION_FAILED: payload: expected object",
      output: "",
    },
  },
});
const validationEncoded = Buffer.from(validationEvent, "utf8").toString("base64");
const validationProbe = runPowerShell(`${recoverableFn}
${signalFn}
$env:FIXUP_SCOUT_AGENT = 'fixup-verification'
$event = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${validationEncoded}'))
Write-Output (Get-OpenCodeErrorSignal $event '')
`);
assert.equal(validationProbe.status, 0, validationProbe.stderr);
assert.match(validationProbe.stdout, /FIXUP_LOCAL_tool_execution/, "pre-HTTP result validation failure must be retryable tool_execution");
assert.doesNotMatch(validationProbe.stdout, /FIXUP_LOCAL_post_failure/, "pre-HTTP result validation failure must not be terminal post_failure");

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