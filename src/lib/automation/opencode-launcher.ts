import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const completedPath = path.join(root, `${input.jobId}.completed`);
  const failedPath = path.join(root, `${input.jobId}.failed`);

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(completedPath, { force: true }),
    rm(failedPath, { force: true }),
  ]);
  await writeFile(promptPath, input.prompt, { encoding: "utf8" });

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
$CompletedFile = ${psQuote(completedPath)}
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
  Write-Host "[FixUp Scout] 생성된 작업 지시 파일을 opencode run에 전달합니다." -ForegroundColor DarkGray
  Write-Host ""

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  & $OpenCode run --file $PromptFile "첨부된 FixUp Scout 작업 지시를 그대로 실행하고 localhost 결과 제출까지 완료해."
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }
  [IO.File]::WriteAllText($CompletedFile, [string]$Code, $Utf8)

  if ($Code -ne 0) {
    throw "OpenCode가 종료 코드 $Code 로 끝났습니다."
  }

  Write-Host ""
  Write-Host "[FixUp Scout] 완료. 결과는 Scout 화면에 자동 반영됩니다." -ForegroundColor Green
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  exit 0
}
catch {
  $FailureMessage = $_.Exception.Message
  try { [IO.File]::WriteAllText($FailedFile, $FailureMessage, $Utf8) } catch {}
  Write-Host ""
  Write-Host "[FixUp Scout] 실행 실패: $FailureMessage" -ForegroundColor Red
  Write-Host "이 창을 닫지 않고 유지합니다." -ForegroundColor Yellow
  Read-Host "확인 후 Enter"
  exit 1
}
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });

  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  try {
    await waitForChildSpawn(child);
    await waitForOpenCodeInvocation(child, invokedPath, completedPath, failedPath);
  } catch (error) {
    child.unref();
    throw error;
  }

  const processId = child.pid ?? null;
  child.unref();

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(completedPath, { force: true }),
    rm(failedPath, { force: true }),
  ]);

  return { command, promptPath, processId };
}

async function waitForChildSpawn(child: ChildProcess) {
  if (child.pid) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("PowerShell 창 시작 확인 시간이 초과되었습니다."));
    }, 3000);

    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(`PowerShell 창을 시작하지 못했습니다: ${error.message}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function waitForOpenCodeInvocation(
  child: ChildProcess,
  invokedPath: string,
  completedPath: string,
  failedPath: string,
) {
  const invokeDeadline = Date.now() + 5000;

  while (Date.now() < invokeDeadline) {
    const failure = await readTextIfPresent(failedPath);
    if (failure) throw new Error(`OpenCode 실행 실패: ${failure}`);

    if (await fileExists(invokedPath)) {
      break;
    }

    if (child.exitCode !== null) {
      await sleep(150);
      const lateFailure = await readTextIfPresent(failedPath);
      if (lateFailure) throw new Error(`OpenCode 실행 실패: ${lateFailure}`);
      if (await fileExists(invokedPath)) break;
      throw new Error(`PowerShell이 OpenCode 호출 단계 전에 종료되었습니다. (exit ${child.exitCode})`);
    }

    await sleep(100);
  }

  if (!(await fileExists(invokedPath))) {
    throw new Error("PowerShell은 시작됐지만 OpenCode 호출 단계까지 진입하지 못했습니다. 열린 창의 오류를 확인하세요.");
  }

  const graceDeadline = Date.now() + 600;
  while (Date.now() < graceDeadline) {
    const failure = await readTextIfPresent(failedPath);
    if (failure) throw new Error(`OpenCode 실행 실패: ${failure}`);

    const completed = await readTextIfPresent(completedPath);
    if (completed !== null) {
      const code = Number(completed);
      if (Number.isFinite(code) && code !== 0) {
        throw new Error(`OpenCode가 시작 직후 종료되었습니다. (exit ${code})`);
      }
      return;
    }

    if (child.exitCode !== null) {
      await sleep(150);
      const lateFailure = await readTextIfPresent(failedPath);
      if (lateFailure) throw new Error(`OpenCode 실행 실패: ${lateFailure}`);
      const lateCompleted = await readTextIfPresent(completedPath);
      if (lateCompleted !== null && Number(lateCompleted) === 0) return;
      throw new Error(`PowerShell이 OpenCode 실행 중 예기치 않게 종료되었습니다. (exit ${child.exitCode})`);
    }

    await sleep(100);
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
