import { getOpenCodeVariantArgsScript } from "./opencode-model-preset";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import path from "node:path";
import { getOpenCodeCommand } from "./config";
import { assertOpenCodeAvailable, getOpenCodeModelChain } from "./opencode-launcher";
import { getOpenCodeAgent } from "./opencode-execution-policy";
import {
  buildDmBatchInputPrompt,
  serializeDmBatchInputPayload,
  validateDmBatchInputs,
  type DmBatchInput,
} from "@/lib/dm/opencode-prompt";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function launchOpenCodeDmBatch(inputs: DmBatchInput[]) {
  const validatedInputs = validateDmBatchInputs(inputs);
  if (validatedInputs.length !== inputs.length) {
    throw new Error(`OpenCode DM batch 검증 수가 일치하지 않습니다: ${validatedInputs.length}/${inputs.length}`);
  }
  for (const input of validatedInputs) {
    if (!UUID_PATTERN.test(input.contactId)) {
      throw new Error(`@${input.handle} contactId가 UUID가 아닙니다.`);
    }
  }

  const serializedPayload = serializeDmBatchInputPayload(validatedInputs);
  const promptInputs = JSON.parse(serializedPayload) as DmBatchInput[];
  if (!Array.isArray(promptInputs) || promptInputs.length !== validatedInputs.length) {
    throw new Error(`OpenCode prompt JSON 수가 일치하지 않습니다: ${Array.isArray(promptInputs) ? promptInputs.length : 0}/${validatedInputs.length}`);
  }
  for (let index = 0; index < validatedInputs.length; index += 1) {
    if (
      promptInputs[index]?.contactId !== validatedInputs[index].contactId
      || promptInputs[index]?.handle !== validatedInputs[index].handle
      || promptInputs[index]?.approvedJapaneseText !== validatedInputs[index].approvedJapaneseText
    ) {
      throw new Error(`OpenCode prompt JSON ${index + 1}번째 데이터가 launcher 원본과 일치하지 않습니다.`);
    }
  }

  assertOpenCodeAvailable();

  const command = getOpenCodeCommand();
  const modelChain = getOpenCodeModelChain();
  const openCodeAgent = getOpenCodeAgent("dm");
  const chromePath = process.env.FIXUP_OPENCODE_CHROME_PATH?.trim()
    || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const chromeProfile = process.env.FIXUP_OPENCODE_CHROME_PROFILE?.trim() || "Profile 3";
  const root = path.join(process.cwd(), ".next", "cache", "fixup-scout");
  await mkdir(root, { recursive: true });

  const expectedCount = validatedInputs.length;
  const batchKey = `${validatedInputs[0].contactId}-${expectedCount}`;
  const promptPath = path.join(root, `dm-batch-${batchKey}.md`);
  const scriptPath = path.join(root, `dm-batch-${batchKey}.ps1`);
  const invokedPath = path.join(root, `dm-batch-${batchKey}.invoked`);
  const failedPath = path.join(root, `dm-batch-${batchKey}.failed`);
  const statusPath = path.join(root, `dm-batch-${batchKey}.status.json`);
  const prompt = buildDmBatchInputPrompt(promptInputs);
  const contactsJson = serializedPayload;

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
    rm(statusPath, { force: true }),
  ]);
  await writeFile(promptPath, prompt, { encoding: "utf8" });

  const script = `$ErrorActionPreference = "Stop"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
try { chcp 65001 > $null } catch {}
$ExpectedCount = ${expectedCount}
try { $Host.UI.RawUI.WindowTitle = ${psQuote(`FixUp Scout · DM batch ${expectedCount}명`)} } catch {}
Set-Location -LiteralPath ${psQuote(process.cwd())}
$OpenCode = ${psQuote(command)}
$PromptFile = ${psQuote(promptPath)}
$InvokedFile = ${psQuote(invokedPath)}
$FailedFile = ${psQuote(failedPath)}
$env:FIXUP_OPENCODE_ERROR_FILE = $FailedFile + ".detail"
$StatusFile = ${psQuote(statusPath)}
$ContactsJson = ${psQuote(contactsJson)}
$ParsedContacts = $ContactsJson | ConvertFrom-Json
$Contacts = @($ParsedContacts | ForEach-Object { $_ })
$ResultUrl = "http://localhost:3000/api/dm/opencode-result"
$OpenCodeAgent = ${psQuote(openCodeAgent)}
$ModelChain = @(${modelChain.map((model) => psQuote(model)).join(", ")})
$ChromePath = ${psQuote(chromePath)}
$ChromeProfile = ${psQuote(chromeProfile)}
$ResumeInstruction = "The launcher already determined the exact pending contacts for this attempt. Do not query, fetch, inspect, or infer contact status yourself. Never navigate, reload, open, or focus localhost:3000 with playwright_b. Use localhost only for the required opencode-result POST after a candidate result. Process only the exact pending handles supplied in this instruction. Never touch any other contact. Never click Send. If any playwright_b call fails with spawn, connection, timeout, or MCP error, do not use agent-browser or another browser; exit without changing or submitting contact results."

function Ensure-PlaywrightBChrome {
  if (-not (Test-Path -LiteralPath $ChromePath)) {
    throw "playwright_b용 Chrome을 찾을 수 없습니다: $ChromePath"
  }
}

function Set-DmFailed($Contact, [string]$Message) {
  try {
    $Body = @{ contactId = [string]$Contact.contactId; handle = [string]$Contact.handle; status = "failed"; error = $Message } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $ResultUrl -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 10 | Out-Null
  } catch {}
}

function Get-DmContact($Contact) {
  try {
    $Url = "http://localhost:3000/api/dm/contacts?id=$([string]$Contact.contactId)"
    return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 10
  } catch {
    return $null
  }
}

function Get-PendingContacts {
  $Pending = @()
  foreach ($Contact in $Contacts) {
    $Saved = Get-DmContact $Contact
    if ($null -eq $Saved -or $null -eq $Saved.contact) { throw "DM contact status lookup failed before fallback." }
    if ($Saved.contact.openCodeStatus -eq "pending") { $Pending += $Contact }
  }
  return @($Pending)
}

function Get-AttemptClassification([int]$ExitCode) {
  switch ($ExitCode) {
    181 { return "auth" }
    182 { return "invalid_model" }
    183 { return "malformed_request" }
    184 { return "tool_incompatible" }
    185 { return "timeout" }
    186 { return "rate_limit" }
    173 { return "confirmed_primary_quota" }
    174 { return "confirmed_provider_quota" }
    175 { return "transient_provider_unavailable" }
    176 { return "confirmed_local_runtime_unavailable" }
    0 { return "completed_with_pending" }
    default { return "exit_code_$ExitCode" }
  }
}

function Write-BatchStatus([string]$TerminalStatus, [object[]]$PendingContacts) {
  $PendingHandles = @($PendingContacts | ForEach-Object { [string]$_.handle })
  $Payload = [ordered]@{
    terminalStatus = $TerminalStatus
    modelChainSnapshot = @($ModelChain)
    attempts = $AttemptHistory.ToArray()
    pendingCount = $PendingHandles.Count
    pendingHandles = $PendingHandles
    updatedAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($StatusFile, $Payload, $Utf8)
}

$AttemptHistory = New-Object 'System.Collections.Generic.List[object]'

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) { throw "FixUp Scout DM batch 프롬프트 파일을 찾을 수 없습니다." }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) { throw "FixUp Scout DM batch 프롬프트가 비어 있습니다." }
  if ($Contacts.Count -ne $ExpectedCount) { throw "FixUp Scout DM batch 수량 불일치: launcher $($Contacts.Count) / expected $ExpectedCount" }
  if ($Contacts.Count -le 0) { throw "FixUp Scout DM batch 승인 데이터가 비어 있습니다." }

  $UniqueHandles = @($Contacts | ForEach-Object { [string]$_.handle } | Sort-Object -Unique)
  $UniqueContactIds = @($Contacts | ForEach-Object { [string]$_.contactId } | Sort-Object -Unique)
  if ($UniqueHandles.Count -ne $ExpectedCount) { throw "FixUp Scout DM batch handle 수량/중복 검증 실패" }
  if ($UniqueContactIds.Count -ne $ExpectedCount) { throw "FixUp Scout DM batch contactId 수량/중복 검증 실패" }
  foreach ($Contact in $Contacts) {
    $Handle = [string]$Contact.handle
    if ($Handle -notmatch '^[A-Za-z0-9._]{1,30}$' -or $Handle.Contains('\\')) {
      throw "잘못된 Instagram handle: $Handle"
    }
  }

  Write-Host "[FixUp Scout] DM batch $ExpectedCount명 · 승인 저장 $ExpectedCount · launcher $($Contacts.Count) · prompt $ExpectedCount" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] 한 PowerShell 창에서 pending 후보만 안전하게 이어서 처리하며 실제 전송은 하지 않습니다." -ForegroundColor Yellow
  Write-Host "[FixUp Scout] batch model chain snapshot: $([string]::Join(' -> ', [string[]]$ModelChain))" -ForegroundColor DarkGray
  Write-Host ""

  Ensure-PlaywrightBChrome

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  $OpenCodeRunCount = 0
  $LastCode = 0
  Write-BatchStatus "running" @(Get-PendingContacts)
  foreach ($Model in $ModelChain) {
    $PendingBefore = @(Get-PendingContacts)
    if ($PendingBefore.Count -eq 0) { break }

    $OpenCodeRunCount += 1
    $PendingHandleList = @($PendingBefore | ForEach-Object { [string]$_.handle })
    $AttemptInstruction = $ResumeInstruction + " Exact pending handles for this attempt: " + [string]::Join(", ", [string[]]$PendingHandleList) + "."
    Write-Host "[FixUp Scout] DM fallback $OpenCodeRunCount/$($ModelChain.Count) · $Model · pending $($PendingBefore.Count)" -ForegroundColor Cyan
    ${getOpenCodeVariantArgsScript("$Model")}
    & $OpenCode run $AttemptInstruction --file $PromptFile --model $Model --agent $OpenCodeAgent @VariantArgs
    $LastCode = $LASTEXITCODE
    if ($null -eq $LastCode) { $LastCode = 0 }

    $PendingAfter = @(Get-PendingContacts)
    $Classification = if ($PendingAfter.Count -eq 0) { "completed" } else { Get-AttemptClassification $LastCode }

    [void]$AttemptHistory.Add([pscustomobject]@{
      attempt = $OpenCodeRunCount
      model = $Model
      exitCode = $LastCode
      classification = $Classification
      pendingBefore = $PendingBefore.Count
      pendingAfter = $PendingAfter.Count
    })
    Write-BatchStatus "running" $PendingAfter
    Write-Host "[FixUp Scout] DM attempt result · model $Model · exit $LastCode · $Classification · pending $($PendingBefore.Count)->$($PendingAfter.Count)" -ForegroundColor DarkGray

    if ($PendingAfter.Count -eq 0) { break }
    if ($LastCode -notin @(173,174,175,184,185,186)) { throw "$(if (Test-Path -LiteralPath $env:FIXUP_OPENCODE_ERROR_FILE) { Get-Content -LiteralPath $env:FIXUP_OPENCODE_ERROR_FILE -Raw -Encoding UTF8 }) DM local execution/result failure: exit=$LastCode pending=$($PendingAfter.Count); fallback denied. See FixUp raw logs." }
    if ($OpenCodeRunCount -lt $ModelChain.Count) {
      $NextModel = [string]$ModelChain[$OpenCodeRunCount]
      if ($LastCode -in @(173, 174, 175, 184, 185, 186)) {
        Write-Host "[FixUp Scout] $Classification 확정 · 대기 없이 다음 fallback -> $NextModel · pending $($PendingAfter.Count)" -ForegroundColor Yellow
      } else {
        Write-Host "[FixUp Scout] $Classification · pending $($PendingAfter.Count)명 · 기존 안전 대기 45초 후 다음 fallback -> $NextModel" -ForegroundColor Yellow
        Start-Sleep -Seconds 45
      }
    }
  }

  $RemainingPending = @(Get-PendingContacts)
  $SuccessCount = 0
  $FailedCount = 0
  $PendingCount = 0
  foreach ($Contact in $Contacts) {
    $Saved = Get-DmContact $Contact
    if ($null -eq $Saved -or $null -eq $Saved.contact -or $Saved.contact.openCodeStatus -eq "pending") {
      $PendingCount += 1
      continue
    }
    if ($Saved.contact.openCodeStatus -eq "success") {
      $SuccessCount += 1
    } else {
      $FailedCount += 1
    }
  }

  $TerminalStatus = if ($PendingCount -gt 0) { "fallback_exhausted_pending" } elseif ($FailedCount -gt 0) { "completed_with_failures" } else { "completed" }
  Write-BatchStatus $TerminalStatus $RemainingPending
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Write-Host ""
  if ($PendingCount -gt 0) {
    $PendingHandles = @($RemainingPending | ForEach-Object { "@" + [string]$_.handle })
    Write-Host "[FixUp Scout] DM batch terminal=$TerminalStatus · fallback $OpenCodeRunCount/$($ModelChain.Count) 소진 · 대상 $ExpectedCount / 성공 $SuccessCount / 영구 실패 $FailedCount / pending $PendingCount · 실제 전송 0" -ForegroundColor Yellow
    Write-Host "[FixUp Scout] pending 유지 이유: 모든 snapshot model attempt 후 terminal contact result 없음 · $([string]::Join(', ', [string[]]$PendingHandles))" -ForegroundColor Yellow
    Write-Host "[FixUp Scout] attempt history/status: $StatusFile" -ForegroundColor DarkGray
  } elseif ($FailedCount -gt 0) {
    Write-Host "[FixUp Scout] DM batch 입력 종료 · 대상 $ExpectedCount / 성공 $SuccessCount / 영구 실패 $FailedCount · 실제 전송 0" -ForegroundColor Yellow
  } else {
    Write-Host "[FixUp Scout] DM batch 입력 준비 완료 · 대상 $ExpectedCount / 성공 $SuccessCount · 실제 전송 0" -ForegroundColor Green
  }
  Read-Host "창을 닫으려면 Enter"
  exit 0
}
catch {
  $Message = $_.Exception.Message
  # 실행 자체의 일시 오류는 후보를 영구 실패로 확정하지 않는다. pending 상태를 유지해 재시도할 수 있게 한다.
  try { [IO.File]::WriteAllText($FailedFile, $Message, $Utf8) } catch {}
  try {
    $PendingAtError = @(Get-PendingContacts)
    $PendingHandlesAtError = @($PendingAtError | ForEach-Object { [string]$_.handle })
    $ErrorPayload = [ordered]@{
      terminalStatus = "launcher_error"
      error = $Message
      modelChainSnapshot = @($ModelChain)
      attempts = $AttemptHistory.ToArray()
      pendingCount = $PendingHandlesAtError.Count
      pendingHandles = $PendingHandlesAtError
      updatedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($StatusFile, $ErrorPayload, $Utf8)
  } catch {}
  Write-Host ""
  Write-Host "[FixUp Scout] DM batch 입력 준비 실패: $Message" -ForegroundColor Red
  Write-Host "승인 이력은 남고, 실제 전송은 하지 않았습니다." -ForegroundColor Yellow
  Read-Host "창을 닫으려면 Enter"
  exit 1
}
`;

  await writeFile(scriptPath, `\uFEFF${script}`, { encoding: "utf8" });

  const launchCommand = `$p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",${psQuote(scriptPath)}) -WorkingDirectory ${psQuote(process.cwd())} -WindowStyle Normal -PassThru; [Console]::Out.Write($p.Id)`;
  const launch = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-Command", launchCommand],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    },
  );

  if (launch.error) throw new Error(`PowerShell 창을 시작하지 못했습니다: ${launch.error.message}`);
  if (launch.status !== 0) {
    const detail = (launch.stderr || launch.stdout || "").trim();
    throw new Error(`PowerShell 창을 시작하지 못했습니다.${detail ? ` ${detail}` : ""}`);
  }

  const processId = Number((launch.stdout || "").trim());
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error("PowerShell 창은 요청됐지만 실행 PID를 확인하지 못했습니다.");
  }

  await waitForOpenCodeInvocation(invokedPath, failedPath);
  await rm(invokedPath, { force: true });
  return {
    command,
    promptPath,
    statusPath,
    processId,
    candidateCount: expectedCount,
    launcherCount: expectedCount,
    promptCount: promptInputs.length,
    openCodeRunCount: 1,
  };
}

export async function launchOpenCodeDmInput(input: DmBatchInput) {
  return launchOpenCodeDmBatch([input]);
}

async function waitForOpenCodeInvocation(invokedPath: string, failedPath: string) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const failure = await readTextIfPresent(failedPath);
    if (failure) throw new Error(`OpenCode 실행 실패: ${failure}`);

    const invoked = await readTextIfPresent(invokedPath);
    if (invoked === "invoked") {
      await sleep(300);
      const immediateFailure = await readTextIfPresent(failedPath);
      if (immediateFailure) throw new Error(`OpenCode 실행 실패: ${immediateFailure}`);
      return;
    }
    await sleep(100);
  }
  throw new Error("OpenCode 호출 시작을 확인하지 못했습니다.");
}

async function readTextIfPresent(filePath: string) {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch {
    return "";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
