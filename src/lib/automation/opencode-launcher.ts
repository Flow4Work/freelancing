import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
  await writeFile(promptPath, input.prompt, { encoding: "utf8" });

  const script = `$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try { $Host.UI.RawUI.WindowTitle = ${psQuote(`FixUp Scout · ${input.title}`)} } catch {}
Set-Location -LiteralPath ${psQuote(process.cwd())}
$OpenCode = ${psQuote(command)}
$PromptFile = ${psQuote(promptPath)}
Write-Host "[FixUp Scout] ${input.title} 시작" -ForegroundColor Cyan
& $OpenCode run --file $PromptFile "첨부된 FixUp Scout 작업 지시를 그대로 실행하고 localhost 결과 제출까지 완료해."
$Code = $LASTEXITCODE
if ($Code -ne 0) {
  Write-Host ""
  Write-Host "[FixUp Scout] OpenCode 실행 실패 (exit $Code)" -ForegroundColor Red
  Read-Host "확인 후 Enter"
  exit $Code
}
Write-Host ""
Write-Host "[FixUp Scout] 완료. 결과는 Scout 화면에 자동 반영됩니다." -ForegroundColor Green
Remove-Item -LiteralPath $PromptFile -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });

  const startCommand = `Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",${psQuote(scriptPath)})`;
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-WindowStyle", "Hidden", "-Command", startCommand],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();

  return { command, promptPath };
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
