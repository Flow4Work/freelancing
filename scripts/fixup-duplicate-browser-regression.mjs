import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import FixUpPlaywrightRefGuard from "../.opencode/plugin/fixup-playwright-ref-guard.mjs";

const root = process.cwd();
const prompt = fs.readFileSync(path.join(root, "src/lib/discovery/duplicate-prompt.ts"), "utf8");
const wrapperPath = path.join(root, "scripts/fixup-opencode-wrapper.ps1");
const launcher = fs.readFileSync(path.join(root, "src/lib/automation/opencode-launcher.ts"), "utf8");
const passed = [];
const ok = (name, value) => { assert.ok(value, name); passed.push(name); };

for (const needle of [
  '첫 browser call은 반드시 playwright_b_browser_tabs action:"list"',
  'playwright_b_browser_tabs action:"new", url:${FIXUP_DUPLICATE_CHECK_URL}',
  'playwright_b_browser_tabs action:"select", index:<그 탭 index>',
  'relay/connect 탭만 있는 fresh start에서는 browser_navigate를 호출하지 않는다',
]) ok(`prompt ${needle}`, prompt.includes(needle));

ok("checkpoint preserved", prompt.includes("localStorage") && prompt.includes("inFlight(index/handle/clickIntentAt)"));
ok("inFlight duplicate suppression preserved", prompt.includes("절대 재클릭하지 않는다") && prompt.includes('duplicateStatus: "unknown"'));
ok("bounded evaluate chunk size", prompt.includes("const maxPerCall = 6") && prompt.includes("processedThisAttempt.length >= maxPerCall"));
ok("bounded evaluate continuation", prompt.includes("hasMore: results.length < candidates.length") && prompt.includes("while hasMore=true"));
ok("late response correlation guard", prompt.includes("classifyMutations = (mutations, expectedHandle)") && prompt.includes('resultText.includes("@" + expectedHandle)'));
ok("current handle passed to observer", prompt.includes("waitForClickedResult(candidate.handle)") && prompt.includes("classifyMutations(mutations, expectedHandle)"));
ok("correlated safety deadline", prompt.includes("6500") && prompt.includes("ignore late responses for earlier handles"));
ok("tool execution is retryable", launcher.includes('@("quota", "rate_limit", "provider_unavailable", "tool_execution")'));
ok("shared browser recovery is same-model bounded", launcher.includes('shared browser/MCP preflight failed; reinitialize same model once') && launcher.includes('shared browser/MCP still unavailable after recovery'));
const hooks = await FixUpPlaywrightRefGuard();
process.env.FIXUP_SCOUT_AGENT = "fixup-duplicate";
const relaySession = "duplicate-relay";
await hooks["tool.execute.after"](
  { tool: "playwright_b_browser_tabs", sessionID: relaySession },
  { output: "### Result\n- 0: (current) [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=x)" },
);
await assert.rejects(
  () => hooks["tool.execute.before"](
    { tool: "playwright_b_browser_navigate", sessionID: relaySession },
    { args: { url: "https://script.google.com/macros/s/test/exec" } },
  ),
  /FIXUP_RELAY_GUARD/,
);
passed.push("relay current navigation blocked");

const workSession = "duplicate-work";
await hooks["tool.execute.after"](
  { tool: "playwright_b_browser_tabs", sessionID: workSession },
  { output: "### Result\n- 0: [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=x)\n- 1: (current) [FixUp](https://script.google.com/macros/s/test/exec)" },
);
await hooks["tool.execute.before"](
  { tool: "playwright_b_browser_navigate", sessionID: workSession },
  { args: { url: "https://example.com/allowed" } },
);
passed.push("normal work-page navigation allowed");
const ps = String.raw`
$src = Get-Content -LiteralPath '${wrapperPath.replaceAll("'", "''")}' -Raw
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
$wanted = @('Test-DmSyncRecoverableClickActionabilityFailure','Get-OpenCodeErrorSignal','Get-LocalFailureCode')
$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true)
foreach ($f in $funcs) { Invoke-Expression $f.Extent.Text }
function Check-BrowserFailure([string]$detail) {
  $event = @{ type='tool_use'; part=@{ tool='playwright_b_browser_fill_form'; state=@{ status='error'; error=$detail; output='' } } } | ConvertTo-Json -Depth 10 -Compress
  $signal = Get-OpenCodeErrorSignal $event ''
  $code = Get-LocalFailureCode $signal
  if ($signal -notmatch 'FIXUP_LOCAL_browser_unavailable' -or $signal -match 'FIXUP_LOCAL_tool_execution' -or $code -ne 176) { Write-Error "$signal code=$code"; exit 2 }
}
Check-BrowserFailure 'Not connected'
Check-BrowserFailure 'Extension not connected'
Check-BrowserFailure 'MCP connection closed server=playwright_b'

$okEvent = @{ type='tool_use'; part=@{ tool='playwright_b_browser_tabs'; state=@{ status='completed'; output='tabs ok' } } } | ConvertTo-Json -Depth 10 -Compress
$timeoutEvent = @{ type='tool_use'; part=@{ tool='playwright_b_browser_evaluate'; state=@{ status='error'; error='MCP error -32001: Request timed out'; output='' } } } | ConvertTo-Json -Depth 10 -Compress
$signal = Get-OpenCodeErrorSignal ($okEvent + [Environment]::NewLine + $timeoutEvent) ''
$code = Get-LocalFailureCode $signal
if ($signal -notmatch 'FIXUP_LOCAL_tool_execution' -or $signal -notmatch 'browser_preflight=passed' -or $signal -match 'FIXUP_LOCAL_browser_unavailable' -or $code -ne 179) { Write-Error "healthy-timeout misclassified: $signal code=$code"; exit 3 }

$signal = Get-OpenCodeErrorSignal $timeoutEvent ''
$code = Get-LocalFailureCode $signal
if ($signal -notmatch 'FIXUP_LOCAL_browser_unavailable' -or $signal -notmatch 'browser_preflight=not_passed' -or $code -ne 176) { Write-Error "preflight-timeout misclassified: $signal code=$code"; exit 4 }
Write-Output 'PASS wrapper browser classification fixtures'
`;
const psRun = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", ps], { encoding: "utf8" });
assert.equal(psRun.status, 0, `${psRun.stdout}\n${psRun.stderr}`);
ok("wrapper browser classification", psRun.stdout.includes("PASS wrapper browser classification fixtures"));

delete process.env.FIXUP_SCOUT_AGENT;
console.log(`PASS ${passed.length}/${passed.length}`);
for (const name of passed) console.log(`PASS ${name}`);
