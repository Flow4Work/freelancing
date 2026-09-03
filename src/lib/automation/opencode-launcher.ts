import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOpenCodeCommand } from "./config";

export function assertLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("자동 실행은 http://localhost:3000 에서만 사용할 수 있습니다.");
  }
  if (process.platform !== "win32") {
    throw new Error("현재 자동 실행은 Windows 로컬 환경에서만 지원합니다.");
  }
}

export function assertOpenCodeAvailable() {
  const command = getOpenCodeCommand();
  const check = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-Command", `$c = Get-Command ${psQuote(command)} -ErrorAction SilentlyContinue; if ($null -eq $c) { exit 1 }`],
    { windowsHide: true, stdio: "ignore" },
  );
  if (check.status !== 0) {
    throw new Error(`OpenCode 명령을 찾지 못했습니다: ${command}`);
  }
}

export async function launchOpenCodeJob(input: { prompt: string; jobId: string; title: string }) {
  const command = getOpenCodeCommand();
  const root = path.join(tmpdir(), "fixup-scout");
  await mkdir(root, { recursive: true });

  const promptPath = path.join(root, `${input.jobId}.md`);
  const scriptPath = path.join(root, `${input.jobId}.ps1`);
  const invokedPath = path.join(root, `${input.jobId}.invoked`);
  const failedPath = path.join(root, `${input.jobId}.failed`);
  const duplicateJob = input.title === "중복 확인";

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
  ]);

  const reliabilityInstruction = duplicateJob
    ? `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 중복 확인이다. 본문에 적힌 1차/2차 batch 저장 방식을 그대로 지키며 후보 1명마다 POST하지 않는다.\n- FixUp 전원 판정 → duplicate/protected/unknown 1차 batch → 필요한 available의 Instagram followers만 확인 → available 2차 batch 순서를 바꾸지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 바로 본문의 FixUp 중복 페이지로 이동한다.\n- BIO/Reels/게시물 검증은 하지 않는다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 batch를 다시 처리하지 않는다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.`
    : `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 Instagram 최종 검증이다. 후보 1명 처리가 끝날 때마다 해당 1건을 즉시 localhost 결과 API에 POST하고 ok:true를 확인한 뒤 다음 후보로 간다.\n- 전체 후보를 끝낸 뒤 한 번에 제출하지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 바로 첫 후보 Instagram 프로필로 이동한다.\n- /reels/ 로딩 실패 시 짧게 대기 → 최신 snapshot → 필요하면 같은 /reels/ 1회 재이동 또는 reload까지만 허용한다. 그래도 조회수를 읽지 못하면 reels:[]와 확인 불가 사유를 note에 넣어 즉시 POST하고 다음 후보로 간다.\n- Reels 실패 때문에 network/GraphQL/request body 분석, HTML dump 반복, 다른 후보 Reels 페이지 재방문을 하지 않는다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 후보를 다시 처리하지 않는다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.`;

  await writeFile(promptPath, `${input.prompt}${reliabilityInstruction}`, { encoding: "utf8" });

  const openCodeInstruction = duplicateJob
    ? "첨부된 FixUp Scout 작업 지시만 실행해. 사전 API/port/code 탐색 없이 바로 FixUp 중복 페이지부터 시작하고, 본문의 최대 2회 batch POST 방식을 그대로 지켜. 마지막 completed:true까지 확인해."
    : "첨부된 FixUp Scout 작업 지시만 실행해. 사전 API/port/code 탐색 없이 바로 첫 후보 Instagram 프로필부터 시작해. 후보 1명마다 즉시 localhost POST하고 마지막 completed:true까지 확인해.";

  const script = `$ErrorActionPreference = "Stop"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
try { chcp 65001 > $null } catch {}
try { $Host.UI.RawUI.WindowTitle = ${psQuote(`FixUp Scout · ${input.title}`)} } catch {}
Set-Location -LiteralPath ${psQuote(process.cwd())}
$OpenCode = ${psQuote(command)}
$PromptFile = ${psQuote(promptPath)}
$InvokedFile = ${psQuote(invokedPath)}
$FailedFile = ${psQuote(failedPath)}
$JobId = ${psQuote(input.jobId)}
$JobUrl = "http://localhost:3000/api/automation/job?jobId=$JobId"

function Get-FixUpJobStatus {
  return Invoke-RestMethod -Uri $JobUrl -Method GET -TimeoutSec 10
}

function Set-FixUpJobFailed([string]$Message) {
  try {
    $Body = @{ jobId = $JobId; error = $Message } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri "http://localhost:3000/api/automation/job" -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 10
  } catch {
    Write-Host "[FixUp Scout] 실패 상태 저장도 실패했습니다: $($_.Exception.Message)" -ForegroundColor DarkYellow
    return $null
  }
}

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) {
    throw "FixUp Scout 프롬프트 파일을 찾을 수 없습니다."
  }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) {
    throw "FixUp Scout 프롬프트가 비어 있습니다."
  }

  Write-Host "[FixUp Scout] ${input.title} · OpenCode 자동 실행" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] 결과 저장 방식은 현재 작업 프롬프트를 따릅니다." -ForegroundColor DarkGray
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  & $OpenCode run ${psQuote(openCodeInstruction)} --file $PromptFile
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }

  $Job = $null
  try { $Job = Get-FixUpJobStatus } catch {}

  if ($null -eq $Job) {
    $FailureMessage = if ($Code -ne 0) { "OpenCode 종료 코드 $Code, 작업 상태 조회 실패" } else { "OpenCode 종료 후 작업 완료 상태를 확인하지 못했습니다." }
    $null = Set-FixUpJobFailed $FailureMessage
    throw $FailureMessage
  }

  if ($Job.status -ne "completed") {
    $Progress = "$($Job.processedCount)/$($Job.totalCount)"
    $FailureMessage = if ($Code -ne 0) {
      "OpenCode가 종료 코드 $Code 로 중단되었습니다. 저장 완료 $Progress"
    } elseif ($Job.status -eq "failed" -and $Job.failureMessage) {
      [string]$Job.failureMessage
    } else {
      "OpenCode가 전체 제출 완료 전에 종료되었습니다. 저장 완료 $Progress"
    }
    if ($Job.status -eq "pending") { $null = Set-FixUpJobFailed $FailureMessage }
    throw $FailureMessage
  }

  Write-Host ""
  Write-Host "[FixUp Scout] 완료 · $($Job.processedCount)/$($Job.totalCount) 결과 저장 확인" -ForegroundColor Green
  Write-Host "이 창은 자동으로 닫히지 않습니다." -ForegroundColor Yellow
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Read-Host "창을 닫으려면 Enter"
  exit 0
}
catch {
  $FailureMessage = $_.Exception.Message
  try {
    $Current = Get-FixUpJobStatus
    if ($Current.status -eq "pending") { $null = Set-FixUpJobFailed $FailureMessage }
  } catch {}
  try { [IO.File]::WriteAllText($FailedFile, $FailureMessage, $Utf8) } catch {}
  Write-Host ""
  Write-Host "[FixUp Scout] 실행 실패: $FailureMessage" -ForegroundColor Red
  Write-Host "이미 POST 성공한 결과는 Scout에 보존됩니다." -ForegroundColor Yellow
  Write-Host "이 창은 자동으로 닫히지 않습니다." -ForegroundColor Yellow
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

  if (launch.error) {
    throw new Error(`PowerShell 창을 시작하지 못했습니다: ${launch.error.message}`);
  }
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

  const failure = await readTextIfPresent(failedPath);
  if (failure) throw new Error(`OpenCode 실행 실패: ${failure}`);
  throw new Error("PowerShell 창은 열렸지만 OpenCode 호출 확인 신호를 받지 못했습니다. 열린 창의 오류를 확인하세요.");
}

async function readTextIfPresent(filePath: string) {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
