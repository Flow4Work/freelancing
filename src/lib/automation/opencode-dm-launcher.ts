import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOpenCodeCommand } from "./config";
import { assertOpenCodeAvailable } from "./opencode-launcher";
import { buildDmInputPrompt } from "@/lib/dm/opencode-prompt";

export async function launchOpenCodeDmInput(input: {
  contactId: string;
  handle: string;
  approvedJapaneseText: string;
}) {
  assertOpenCodeAvailable();

  const command = getOpenCodeCommand();
  const root = path.join(tmpdir(), "fixup-scout");
  await mkdir(root, { recursive: true });

  const promptPath = path.join(root, `dm-${input.contactId}.md`);
  const scriptPath = path.join(root, `dm-${input.contactId}.ps1`);
  const invokedPath = path.join(root, `dm-${input.contactId}.invoked`);
  const failedPath = path.join(root, `dm-${input.contactId}.failed`);
  const prompt = buildDmInputPrompt(input);

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
try { $Host.UI.RawUI.WindowTitle = ${psQuote(`FixUp Scout · DM @${input.handle}`)} } catch {}
Set-Location -LiteralPath ${psQuote(process.cwd())}
$OpenCode = ${psQuote(command)}
$PromptFile = ${psQuote(promptPath)}
$InvokedFile = ${psQuote(invokedPath)}
$FailedFile = ${psQuote(failedPath)}
$ContactId = ${psQuote(input.contactId)}
$Handle = ${psQuote(input.handle)}
$ResultUrl = "http://localhost:3000/api/dm/opencode-result"
$ContactUrl = "http://localhost:3000/api/dm/contacts?id=$ContactId"

function Set-DmFailed([string]$Message) {
  try {
    $Body = @{ contactId = $ContactId; handle = $Handle; status = "failed"; error = $Message } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $ResultUrl -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 10 | Out-Null
  } catch {}
}

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) { throw "FixUp Scout DM 프롬프트 파일을 찾을 수 없습니다." }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) { throw "FixUp Scout DM 프롬프트가 비어 있습니다." }

  Write-Host "[FixUp Scout] @${input.handle} · 승인 DM 입력 준비" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] 전송 버튼은 누르지 않습니다." -ForegroundColor Yellow
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  & $OpenCode run "첨부된 FixUp Scout DM 입력 지시만 실행해. 승인 원문을 입력창에 그대로 넣고 절대 전송하지 마." --file $PromptFile
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }

  $Contact = $null
  try { $Contact = Invoke-RestMethod -Uri $ContactUrl -Method GET -TimeoutSec 10 } catch {}
  if ($null -eq $Contact -or $Contact.contact.openCodeStatus -eq "pending") {
    $Message = if ($Code -ne 0) { "OpenCode 종료 코드 $Code, DM 입력 완료 결과 없음" } else { "OpenCode가 DM 입력 완료 결과를 저장하지 않고 종료되었습니다." }
    Set-DmFailed $Message
    throw $Message
  }

  if ($Contact.contact.openCodeStatus -eq "failed") {
    throw ([string]$Contact.contact.openCodeError)
  }

  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "[FixUp Scout] DM 입력 준비 완료 · 전송하지 않음" -ForegroundColor Green
  Read-Host "창을 닫으려면 Enter"
  exit 0
}
catch {
  $Message = $_.Exception.Message
  Set-DmFailed $Message
  try { [IO.File]::WriteAllText($FailedFile, $Message, $Utf8) } catch {}
  Write-Host ""
  Write-Host "[FixUp Scout] DM 입력 준비 실패: $Message" -ForegroundColor Red
  Write-Host "후보는 Scout에 남아 다시 확인할 수 있습니다." -ForegroundColor Yellow
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
  return { command, promptPath, processId };
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
