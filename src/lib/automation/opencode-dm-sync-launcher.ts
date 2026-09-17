import { getOpenCodeVariantArgsScript } from "./opencode-model-preset";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOpenCodeCommand } from "./config";
import { getOpenCodeAgent } from "./opencode-execution-policy";
import { assertOpenCodeAvailable, getOpenCodeModelChain } from "./opencode-launcher";
import { buildDmSentSyncPrompt, validateDmSentSyncInputs, type DmSentSyncInput } from "@/lib/dm/sync-prompt";
import type { SearchCategory } from "@/lib/discovery/types";
import { isDmSyncLockActive, releaseDmSyncLock, tryAcquireDmSyncLock } from "./dm-sync-lock";

export async function launchOpenCodeDmSentSyncBatch(category: SearchCategory, inputs: DmSentSyncInput[]) {
  const validated = validateDmSentSyncInputs(inputs);
  assertOpenCodeAvailable();
  const root = path.join(process.cwd(), ".next", "cache", "fixup-scout");
  await mkdir(root, { recursive: true });
  const chromePath = process.env.FIXUP_OPENCODE_CHROME_PATH?.trim() || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const chromeProfile = process.env.FIXUP_OPENCODE_CHROME_PROFILE?.trim() || "Profile 3";
  const lockPath = syncLockPath(root, chromeProfile);
  const lockToken = randomUUID();
  if (!await tryAcquireDmSyncLock(lockPath, lockToken, chromeProfile)) {
    return { alreadyRunning: true, processId: null, candidateCount: validated.length };
  }

  const batchKey = `${category}-${Date.now()}-${validated.length}`;
  const promptPath = path.join(root, `dm-sent-sync-${batchKey}.md`);
  const scriptPath = path.join(root, `dm-sent-sync-${batchKey}.ps1`);
  const invokedPath = path.join(root, `dm-sent-sync-${batchKey}.invoked`);
  const failedPath = path.join(root, `dm-sent-sync-${batchKey}.failed`);
  const command = getOpenCodeCommand();
  const modelChain = getOpenCodeModelChain();
  const openCodeAgent = getOpenCodeAgent("dm-sync");
  const mutexName = `Local\\FixUpScoutDmSync-${syncProfileKey(chromeProfile)}`;

  await Promise.all([rm(invokedPath, { force: true }), rm(failedPath, { force: true })]);
  await writeFile(promptPath, buildDmSentSyncPrompt(validated), "utf8");

  const script = `$ErrorActionPreference = "Stop"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
try { chcp 65001 > $null } catch {}
Set-Location -LiteralPath ${psQuote(process.cwd())}
$OpenCode = ${psQuote(command)}
$PromptFile = ${psQuote(promptPath)}
$InvokedFile = ${psQuote(invokedPath)}
$FailedFile = ${psQuote(failedPath)}
$env:FIXUP_OPENCODE_ERROR_FILE = $FailedFile + ".detail"
$LockFile = ${psQuote(lockPath)}
$LockToken = ${psQuote(lockToken)}
$ChromePath = ${psQuote(chromePath)}
$ChromeProfile = ${psQuote(chromeProfile)}
$OpenCodeAgent = ${psQuote(openCodeAgent)}
$env:FIXUP_SCOUT_AGENT = $OpenCodeAgent
$MutexName = ${psQuote(mutexName)}
$Mutex = New-Object System.Threading.Mutex($false, $MutexName)
$MutexHeld = $false
$ExpectedIds = @((ConvertFrom-Json -InputObject ${psQuote(JSON.stringify(validated.map((item) => item.contactId)))}) | ForEach-Object { $_ })
try { $Host.UI.RawUI.WindowTitle = "FixUp Scout · 발송 확인 $($ExpectedIds.Count)명" } catch {}
Write-Host "[FixUp Scout] 발송 확인 OpenCode 시작 · $($ExpectedIds.Count)명"
$SavedIds = New-Object 'System.Collections.Generic.HashSet[string]'
$AttemptLog = $FailedFile + ".attempts.jsonl"
$ModelChain = @(${modelChain.map((model) => psQuote(model)).join(", ")})
$Instruction = "Check only the attached FixUp DM sent-status list. Use playwright_b/Profile 3. First call browser_tabs list and acquire a non-relay Instagram Direct work tab exactly as the attached lifecycle rules require. Search each exact handle only in Instagram Direct inbox, inspect the conversation, submit the result, and continue. Never send a message."
try {
  $MutexHeld = $Mutex.WaitOne(0)
  if (-not $MutexHeld) { throw "DM sent sync profile already running: $ChromeProfile" }
  if (-not (Test-Path -LiteralPath $ChromePath)) { throw "playwright_b Chrome not found" }
  $LockState = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$LockState.token -ne $LockToken) { throw "DM sent sync lock ownership lost" }
  $LockState.processId = $PID
  [IO.File]::WriteAllText($LockFile, ($LockState | ConvertTo-Json -Compress), $Utf8)
  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  $Completed = $false
  foreach ($Model in $ModelChain) {
    ${getOpenCodeVariantArgsScript("$Model")}
    $RemainingIds = @($ExpectedIds | Where-Object { -not $SavedIds.Contains([string]$_) })
    $RunInstruction = $Instruction + " Process only these remaining contactIds: " + [string]::Join(", ", [string[]]$RemainingIds)
    $RunOutput = @(& $OpenCode run $RunInstruction --file $PromptFile --model $Model --agent $OpenCodeAgent @VariantArgs)
    $RunCode = $LASTEXITCODE
    foreach ($Line in $RunOutput) {
      [IO.File]::AppendAllText($AttemptLog, [string]$Line + [Environment]::NewLine, $Utf8)
      try {
        $Event = $Line | ConvertFrom-Json -ErrorAction Stop
        if ($Event.type -eq "tool_use" -and $Event.part.tool -eq "fixup_result_sync" -and $Event.part.state.status -eq "completed") {
          $Receipt = $Event.part.state.output | ConvertFrom-Json -ErrorAction Stop
          if ($Receipt.ok -eq $true -and $Receipt.fixupReceipt.endpoint -eq "/api/dm/sync-result") { [void]$SavedIds.Add([string]$Receipt.fixupReceipt.id) }
        }
      } catch {}
    }
    $Code = $RunCode
    if ($null -eq $Code) { $Code = 0 }

    if (@($ExpectedIds | Where-Object { -not $SavedIds.Contains([string]$_) }).Count -eq 0) { $Completed = $true; break }
    if ($Code -notin @(173,174,175)) { throw "$(if (Test-Path -LiteralPath $env:FIXUP_OPENCODE_ERROR_FILE) { Get-Content -LiteralPath $env:FIXUP_OPENCODE_ERROR_FILE -Raw -Encoding UTF8 }) DM sync result incomplete/local failure: exit=$Code saved=$($SavedIds.Count)/$($ExpectedIds.Count); fallback denied. See $AttemptLog and FixUp raw logs." }
    Start-Sleep -Milliseconds 500
  }
  if (-not $Completed) { throw "OpenCode sent sync fallback exhausted" }
} catch {
  try { [IO.File]::WriteAllText($FailedFile, $_.Exception.Message, $Utf8) } catch {}
  exit 1
} finally {
  if ($MutexHeld) { try { $Mutex.ReleaseMutex() } catch {} }
  if ($null -ne $Mutex) { try { $Mutex.Dispose() } catch {} }
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  try {
    if (Test-Path -LiteralPath $LockFile) {
      $CurrentLock = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ([string]$CurrentLock.token -eq $LockToken) { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}
exit 0
`;
  await writeFile(scriptPath, `\uFEFF${script}`, "utf8");

  const launchCommand = `$p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",${psQuote(scriptPath)}) -WorkingDirectory ${psQuote(process.cwd())} -WindowStyle Normal -PassThru; [Console]::Out.Write($p.Id)`;
  const launch = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", launchCommand], { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (launch.error || launch.status !== 0) {
    await releaseDmSyncLock(lockPath, lockToken);
    throw new Error(`DM sent sync PowerShell launch failed: ${launch.error?.message ?? (launch.stderr || launch.stdout || "").trim()}`);
  }
  const processId = Number((launch.stdout || "").trim());
  if (!Number.isInteger(processId) || processId <= 0) {
    await releaseDmSyncLock(lockPath, lockToken);
    throw new Error("DM sent sync PowerShell PID unavailable");
  }
  await waitForInvocation(invokedPath, failedPath);
  await rm(invokedPath, { force: true });
  return { alreadyRunning: false, processId, candidateCount: validated.length };
}

export async function isDmSentSyncRunning(_category: SearchCategory) {
  const root = path.join(process.cwd(), ".next", "cache", "fixup-scout");
  const chromeProfile = process.env.FIXUP_OPENCODE_CHROME_PROFILE?.trim() || "Profile 3";
  return isDmSyncLockActive(syncLockPath(root, chromeProfile));
}

function syncProfileKey(profile: string) {
  return profile.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
}
function syncLockPath(root: string, profile: string) {
  return path.join(root, `dm-sent-sync-${syncProfileKey(profile)}.lock`);
}
async function waitForInvocation(invokedPath: string, failedPath: string) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const failure = await readTextIfPresent(failedPath);
    if (failure) throw new Error(`OpenCode sent sync failed: ${failure}`);
    if (await readTextIfPresent(invokedPath) === "invoked") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("OpenCode sent sync invocation not confirmed");
}
async function readTextIfPresent(filePath: string) { try { return (await readFile(filePath, "utf8")).trim(); } catch { return ""; } }
function psQuote(value: string) { return `'${value.replace(/'/g, "''")}'`; }