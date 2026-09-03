import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOpenCodeCommand } from "./config";
import { assertOpenCodeAvailable } from "./opencode-launcher";
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
  const root = path.join(tmpdir(), "fixup-scout");
  await mkdir(root, { recursive: true });

  const expectedCount = validatedInputs.length;
  const batchKey = `${validatedInputs[0].contactId}-${expectedCount}`;
  const promptPath = path.join(root, `dm-batch-${batchKey}.md`);
  const scriptPath = path.join(root, `dm-batch-${batchKey}.ps1`);
  const invokedPath = path.join(root, `dm-batch-${batchKey}.invoked`);
  const failedPath = path.join(root, `dm-batch-${batchKey}.failed`);
  const prompt = buildDmBatchInputPrompt(promptInputs);
  const contactsJson = JSON.stringify(promptInputs.map((input) => ({
    contactId: input.contactId,
    handle: input.handle,
  })));

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
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
$ContactsJson = ${psQuote(contactsJson)}
$ParsedContacts = $ContactsJson | ConvertFrom-Json
$Contacts = @($ParsedContacts | ForEach-Object { $_ })
$ResultUrl = "http://localhost:3000/api/dm/opencode-result"

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
  Write-Host "[FixUp Scout] OpenCode는 정확히 1회만 실행하며 실제 전송은 하지 않습니다." -ForegroundColor Yellow
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  $OpenCodeRunCount = 0
  $OpenCodeRunCount += 1
  & $OpenCode run "첨부된 FixUp Scout DM batch 지시만 실행해. Scout localhost 탭은 그대로 보존하고, 후보마다 별도 Instagram 탭을 만들어 승인 원문을 입력만 하고 절대 전송하지 마." --file $PromptFile
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }
  if ($OpenCodeRunCount -ne 1) { throw "OpenCode 실행 횟수 불일치: $OpenCodeRunCount" }

  $SuccessCount = 0
  $FailedCount = 0
  foreach ($Contact in $Contacts) {
    $Saved = Get-DmContact $Contact
    if ($null -eq $Saved -or $null -eq $Saved.contact -or $Saved.contact.openCodeStatus -eq "pending") {
      $Message = if ($Code -ne 0) { "OpenCode 종료 코드 $Code, 해당 후보 DM 입력 완료 결과 없음" } else { "OpenCode가 해당 후보 DM 입력 완료 결과를 저장하지 않고 종료되었습니다." }
      Set-DmFailed $Contact $Message
      $FailedCount += 1
      continue
    }
    if ($Saved.contact.openCodeStatus -eq "success") {
      $SuccessCount += 1
    } else {
      $FailedCount += 1
    }
  }

  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Write-Host ""
  if ($FailedCount -gt 0) {
    Write-Host "[FixUp Scout] DM batch 입력 종료 · 대상 $ExpectedCount / OpenCode 1회 / 성공 $SuccessCount / 실패 $FailedCount · 실제 전송 0" -ForegroundColor Yellow
  } else {
    Write-Host "[FixUp Scout] DM batch 입력 준비 완료 · 대상 $ExpectedCount / OpenCode 1회 / 성공 $SuccessCount · 실제 전송 0" -ForegroundColor Green
  }
  Read-Host "창을 닫으려면 Enter"
  exit 0
}
catch {
  $Message = $_.Exception.Message
  foreach ($Contact in $Contacts) {
    $Saved = Get-DmContact $Contact
    if ($null -eq $Saved -or $null -eq $Saved.contact -or $Saved.contact.openCodeStatus -eq "pending") {
      Set-DmFailed $Contact $Message
    }
  }
  try { [IO.File]::WriteAllText($FailedFile, $Message, $Utf8) } catch {}
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
