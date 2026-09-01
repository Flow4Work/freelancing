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
  const completedPath = path.join(root, `${input.jobId}.completed`);

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
    rm(completedPath, { force: true }),
  ]);

  const duplicatePriorityInstruction = input.title === "중복 확인"
    ? `\n\n[최우선 실행 규칙]\n- 후보는 주어진 순서대로 정확히 한 번씩만 검사한다. 이미 검사한 후보를 다시 검사하지 않는다.\n- 목록에 없는 테스트 계정을 입력하지 않는다.\n- 결과 형식을 알아보기 위한 추가 실험, iframe/DOM 구조 연구, 디버깅, playwright_b_browser_run_code_unsafe 사용을 금지한다.\n- 로그인 후 입력칸과 중복 확인 버튼을 찾으면 같은 폼을 계속 사용한다. 실제 동작 실패가 없는 한 다시 탐색하지 않는다.\n- 각 후보는 입력칸 비우기 → ID 입력 → 중복 확인 클릭 → 화면 결과 판정만 수행한다.\n- 마지막 후보 판정 직후 즉시 전체 결과를 localhost:3000/api/duplicate/results 로 POST한다.\n- POST 응답의 ok:true를 확인한 뒤에는 브라우저 검색/검사/재확인을 단 한 번도 더 하지 않고 바로 완료 신호를 만든다.\n- 후보 하나라도 판정할 수 없으면 추가 연구하지 말고 즉시 실패 종료한다.`
    : "";

  const completionInstruction = `\n\n마지막 성공 신호:\n- localhost 결과 제출 응답의 \"ok\":true를 실제 확인한 뒤에만 아래 PowerShell 명령을 정확히 한 번 실행한다.\n- 제출 실패, 로그인 실패, 검증 실패, 중간 종료 상태에서는 이 파일을 절대 만들지 않는다.\nSet-Content -LiteralPath ${psQuote(completedPath)} -Value ok -Encoding ASCII\n- 이 완료 신호까지 만든 뒤에만 OpenCode 작업을 정상 종료한다.`;

  await writeFile(promptPath, `${input.prompt}${duplicatePriorityInstruction}${completionInstruction}`, { encoding: "utf8" });

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
$CompletedFile = ${psQuote(completedPath)}

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) {
    throw "FixUp Scout 프롬프트 파일을 찾을 수 없습니다."
  }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) {
    throw "FixUp Scout 프롬프트가 비어 있습니다."
  }

  Write-Host "[FixUp Scout] ${input.title} · OpenCode 자동 실행" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] 생성된 작업 지시 파일을 opencode run에 전달합니다." -ForegroundColor DarkGray
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  & $OpenCode run "첨부된 FixUp Scout 작업 지시를 그대로 실행하고 localhost 결과 제출까지 완료해." --file $PromptFile
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }
  if ($Code -ne 0) {
    throw "OpenCode가 종료 코드 $Code 로 끝났습니다."
  }

  if (-not (Test-Path -LiteralPath $CompletedFile)) {
    throw "OpenCode가 종료됐지만 localhost 결과 제출 완료 신호가 없습니다. 로그인/페이지 접근/결과 POST가 끝나지 않은 상태입니다."
  }

  $CompletionValue = (Get-Content -LiteralPath $CompletedFile -Raw).Trim()
  if ($CompletionValue -ne "ok") {
    throw "localhost 결과 제출 완료 신호가 올바르지 않습니다."
  }

  Write-Host ""
  Write-Host "[FixUp Scout] 완료. localhost 결과 제출 확인됨." -ForegroundColor Green
  Write-Host "이 창은 자동으로 닫히지 않습니다." -ForegroundColor Yellow
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $CompletedFile -ErrorAction SilentlyContinue
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
