import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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
  const readyPath = path.join(root, `${input.jobId}.ready`);
  await rm(readyPath, { force: true });
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
$ReadyFile = ${psQuote(readyPath)}

try {
  $ResolvedOpenCode = Get-Command $OpenCode -ErrorAction Stop
  $Prompt = [IO.File]::ReadAllText($PromptFile, [Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($Prompt)) {
    throw "FixUp Scout 프롬프트가 비어 있습니다."
  }

  [IO.File]::WriteAllText($ReadyFile, "ready", $Utf8)
  Write-Host "[FixUp Scout] ${input.title} · OpenCode 준비 완료" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] OpenCode TUI를 시작합니다. 작업 프롬프트가 자동으로 전달됩니다." -ForegroundColor DarkGray
  Write-Host ""

  & $ResolvedOpenCode.Source --prompt $Prompt
  $Code = $LASTEXITCODE
  if ($null -eq $Code) { $Code = 0 }
  if ($Code -ne 0) {
    throw "OpenCode가 종료 코드 $Code 로 끝났습니다."
  }

  Write-Host ""
  Write-Host "[FixUp Scout] OpenCode가 종료되었습니다. Scout 화면의 결과 반영 여부를 확인하세요." -ForegroundColor Green
  Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ReadyFile -ErrorAction SilentlyContinue
}
catch {
  Write-Host ""
  Write-Host "[FixUp Scout] 실행 실패: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "이 창을 닫지 않고 유지합니다." -ForegroundColor Yellow
  Read-Host "확인 후 Enter"
  exit 1
}
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });

  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  try {
    await waitForChildSpawn(child);
    await waitForReadyFile(child, readyPath);
  } catch (error) {
    child.unref();
    throw error;
  }

  child.unref();
  return { command, promptPath };
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

async function waitForReadyFile(child: ChildProcess, readyPath: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await access(readyPath);
      return;
    } catch {
      if (child.exitCode !== null) {
        throw new Error(`PowerShell이 OpenCode 실행 준비 전에 종료되었습니다. (exit ${child.exitCode})`);
      }
      await sleep(100);
    }
  }
  throw new Error("PowerShell은 시작됐지만 OpenCode 실행 준비를 확인하지 못했습니다. 열린 창의 오류를 확인하세요.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
