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

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
  ]);

  const duplicatePriorityInstruction = input.title === "중복 확인"
    ? `\n\n[최우선]\n- 후보는 순서대로 정확히 1회만 검사한다.\n- 중간 보고, 재검사, 테스트 계정, 추가 연구, run_code_unsafe, Temp 파일 생성을 하지 않는다.\n- 마지막 후보 직후 Invoke-RestMethod 직접 POST로 localhost:3000/api/duplicate/results 에 제출한다.\n- POST ok:true 확인 후 추가 작업 없이 종료한다.`
    : "";

  await writeFile(promptPath, `${input.prompt}${duplicatePriorityInstruction}`, { encoding: "utf8" });

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

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) {
    throw "FixUp Scout 프롬프트 파일을 찾을 수 없습니다."
  }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) {
    throw "FixUp Scout 프롬프트가 비어 있습니다."
  }

  Write-Host "[FixUp Scout] ${input.title} · OpenCode 자동 실행" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] 작업 지시를 opencode run에 전달합니다." -ForegroundColor DarkGray
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  & $OpenCode run "첨부된 FixUp Scout 작업 지시만 실행해. 파일 저장 없이 localhost POST까지 완료해." --file $PromptFile
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }
  if ($Code -ne 0) {
    throw "OpenCode가 종료 코드 $Code 로 끝났습니다."
  }

  Write-Host ""
  Write-Host "[FixUp Scout] OpenCode 실행 종료. 제출 결과는 위 로그와 Scout 화면에서 확인하세요." -ForegroundColor Green
  Write-Host "이 창은 자동으로 닫히지 않습니다." -ForegroundColor Yellow
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Read-Host "창을 닫으려면 Enter"
  exit 0
}
catch {
  $FailureMessage = $_.Exception.Message
  try { [IO.File]::WriteAllText($FailedFile, $FailureMessage, $Utf8) } catch {}
  Write-Host ""
  Write-Host "[FixUp Scout] 실행 실패: $FailureMessage" -ForegroundColor Red
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
