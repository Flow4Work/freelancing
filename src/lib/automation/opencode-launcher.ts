import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOpenCodeCommand } from "./config";
import { getApiConnections } from "./api-connections";
import { getOpenCodeModelChain, getOpenCodeVariantArgsScript } from "./opencode-model-preset";
import { getOpenCodeAgent } from "./opencode-execution-policy";
import { getOpenCodeRuntimeRoot, getVerificationPostFailurePath } from "./opencode-runtime";

export { getOpenCodeModelChain } from "./opencode-model-preset";

const DEFAULT_MAX_RETRY_AFTER_SECONDS = 15;

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
  if (getOpenCodeModelChain()[0] === "bai/deepseek-v4.1-flash" && !getApiConnections().find((item) => item.id === "bai")?.connected) {
    throw new Error("B.AI API Key를 API 연결 화면에서 먼저 저장해 주세요.");
  }
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

export async function launchOpenCodeJob(input: { prompt: string; jobId: string; title: string; mode: "duplicate" | "verification" }) {
  const command = getOpenCodeCommand();
  const root = getOpenCodeRuntimeRoot();
  await mkdir(root, { recursive: true });

  const promptPath = path.join(root, `${input.jobId}.md`);
  const scriptPath = path.join(root, `${input.jobId}.ps1`);
  const invokedPath = path.join(root, `${input.jobId}.invoked`);
  const failedPath = path.join(root, `${input.jobId}.failed`);
  const openCodeLogPath = path.join(root, `${input.jobId}.opencode.log`);
  const watcherPath = path.join(root, `${input.jobId}.watch.ps1`);
  const watcherLogPath = path.join(root, `${input.jobId}.watch.log`);
  const heartbeatPath = path.join(root, `${input.jobId}.heartbeat`);
  const postFailurePath = getVerificationPostFailurePath(input.jobId);
  const duplicateJob = input.mode === "duplicate";
  const openCodeAgent = getOpenCodeAgent(input.mode);
  const modelChain = getOpenCodeModelChain();
  const chromePath = process.env.FIXUP_OPENCODE_CHROME_PATH?.trim()
    || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const chromeProfile = process.env.FIXUP_OPENCODE_CHROME_PROFILE?.trim() || "Profile 3";
  const maxRetryAfterSeconds = getBoundedInteger(
    "FIXUP_OPENCODE_MAX_RETRY_AFTER_SECONDS",
    DEFAULT_MAX_RETRY_AFTER_SECONDS,
    1,
    60,
  );

  await Promise.all([
    rm(invokedPath, { force: true }),
    rm(failedPath, { force: true }),
    rm(openCodeLogPath, { force: true }),
    rm(watcherPath, { force: true }),
    rm(watcherLogPath, { force: true }),
    rm(heartbeatPath, { force: true }),
    rm(postFailurePath, { force: true }),
  ]);

  const resumeInstruction = `\n- The launcher resolves job progress before every attempt and injects the exact remaining handles into the run instruction. Process only those handles.\n- Never call /api/automation/job, verification/results GET, /health, or any status endpoint yourself.\n- A handle omitted from the launcher-provided remaining list is already processed and must never be revisited or POSTed again.`;
  const duplicateResumeInstruction = `\n- The launcher resolves the job terminal state. Candidate-level resume is owned only by the Apps Script origin localStorage checkpoint described in the task prompt.\n- Never call /api/automation/job, verification/results GET, /health, or any status endpoint yourself.\n- A valid checkpoint result or inFlight recovery must never be re-clicked; continue only from the first unfinished checkpoint entry.`;
  const reliabilityInstruction = duplicateJob
    ? `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 중복 확인이다. FixUp 전원 판정 → 전원 결과 정확히 1회 batch POST → completed:true 확인 순서만 실행한다.\n- Instagram은 절대 열지 않는다. followers/BIO/Reels/게시물/DM은 최종 검증 단계에서만 확인한다.\n- 후보별 POST, 1차/2차 분할 POST, available 별도 후처리를 하지 않는다.\n- 본문의 단일 async browser_evaluate DOM loop를 사용한다. 후보별 fill/find/snapshot/click/wait tool round-trip으로 되돌아가지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 현재 browser form/checkpoint를 먼저 확인하고, form이 없을 때만 본문의 FixUp 중복 페이지로 이동한다.\n- playwright_b 호출이 spawn/연결/timeout/MCP 오류로 실패하면 agent-browser, 다른 브라우저, webfetch, curl/Invoke-WebRequest, 직접 HTTP, 패키지 설치로 우회하지 않는다. 결과를 추정하거나 POST하지 말고 즉시 종료한다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실제 호출 후 응답 유실/실패 시 임의 재전송하지 않고 attempt를 종료한다. launcher가 job 상태를 다시 확인한다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.${duplicateResumeInstruction}`
    : `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 Instagram 최종 검증이다. 후보 1명 처리가 끝날 때마다 해당 1건을 즉시 localhost 결과 API에 POST하고 ok:true를 확인한 뒤 다음 후보로 간다.\n- 전체 후보를 끝낸 뒤 한 번에 제출하지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 바로 첫 후보 Instagram 프로필로 이동한다.\n- playwright_b 호출이 spawn/연결/MCP 자체 오류로 실패하면 agent-browser, 다른 브라우저, webfetch, curl/Invoke-WebRequest, 직접 HTTP, 패키지 설치로 우회하지 않는다. 결과를 추정하거나 POST하지 말고 즉시 종료한다.\n- 단, 최종 검증에서 첫 stale ref(Ref ... not found) 또는 현재 ref click actionability 5초 timeout은 복구 가능한 도구 오류다. 그 즉시 browser_snapshot({})을 target 없이 새로 1회 받아 현재 페이지의 최신 ref만 사용해 같은 읽기/클릭을 정확히 1회 재시도한다.\n- 같은 attempt에서 두 번째 stale ref/actionability timeout이 나거나 fresh snapshot 재시도도 실패하면 더 반복하지 말고 attempt를 종료해 supervisor fallback에 맡긴다. browser_snapshot에는 절대 target/ref를 전달하지 않는다.\n- /reels/ 로딩 실패 시 짧게 대기 → 최신 snapshot → 필요하면 같은 /reels/ 1회 재이동 또는 reload까지만 허용한다. 그래도 조회수를 읽지 못하면 reels:[]와 확인 불가 사유를 note에 넣어 즉시 POST하고 다음 후보로 간다.\n- Reels 실패 때문에 network/GraphQL/request body 분석, HTML dump 반복, 다른 후보 Reels 페이지 재방문을 하지 않는다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 후보를 다시 처리하지 않는다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.${resumeInstruction}`;

  await writeFile(promptPath, `${input.prompt}${reliabilityInstruction}`, { encoding: "utf8" });

  const openCodeInstruction = duplicateJob
    ? "Execute only the attached FixUp duplicate-check task. Do not query job status yourself. Use the durable browser checkpoint, perform only the required duplicate result POST, and stop immediately after completed:true."
    : "Execute only the attached FixUp Instagram verification task. Do not query job status yourself. Process only the exact launcher-provided remaining handles, POST each completed candidate once, and stop immediately after completed:true.";
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
$AttemptLogFile = ${psQuote(openCodeLogPath)}
$HeartbeatFile = ${psQuote(heartbeatPath)}
$PostFailureFile = ${psQuote(postFailurePath)}
$OpenCodeAgent = ${psQuote(openCodeAgent)}
$ExecutionMode = ${psQuote(input.mode)}
$JobId = ${psQuote(input.jobId)}
$JobUrl = "http://localhost:3000/api/automation/job?jobId=$JobId"
$OpenCodeInstruction = ${psQuote(openCodeInstruction)}
$ModelChain = @(${modelChain.map((model) => psQuote(model)).join(", ")})
$MaxRetryAfterSeconds = ${maxRetryAfterSeconds}
$PollSeconds = 5
$ChromePath = ${psQuote(chromePath)}
$ChromeProfile = ${psQuote(chromeProfile)}

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

function Write-Heartbeat {
  try { [IO.File]::WriteAllText($HeartbeatFile, "$PID|$(Get-Date -Format o)", $Utf8) } catch {}
}

function Get-VerificationPostFailure {
  if (-not (Test-Path -LiteralPath $PostFailureFile)) { return $null }
  try {
    $Message = (Get-Content -LiteralPath $PostFailureFile -Raw -ErrorAction Stop).Trim()
    if ([string]::IsNullOrWhiteSpace($Message)) { return "verification POST failed" }
    return $Message
  } catch {
    return "verification POST failed"
  }
}

function Ensure-PlaywrightBChrome {
  if (-not (Test-Path -LiteralPath $ChromePath)) {
    throw "playwright_b용 Chrome을 찾을 수 없습니다: $ChromePath"
  }
}

function Get-ProviderName([string]$Model) {
  if ([string]::IsNullOrWhiteSpace($Model)) { return "unknown" }
  $Slash = $Model.IndexOf("/")
  if ($Slash -le 0) { return "unknown" }
  return $Model.Substring(0, $Slash)
}

function Write-AttemptEvent([string]$Model, [string]$Classification, [bool]$Fallback, [string]$Detail) {
  $Provider = Get-ProviderName $Model
  $SafeDetail = ($Detail -replace '[\\t\\r\\n ]+', ' ').Trim()
  if ($SafeDetail.Length -gt 220) { $SafeDetail = $SafeDetail.Substring(0, 220) }
  $Line = "[FixUp Scout][attempt] provider=$Provider model=$Model classification=$Classification fallback=$Fallback detail=$SafeDetail"
  Write-Host $Line -ForegroundColor DarkGray
  try { [IO.File]::AppendAllText($AttemptLogFile, $Line + [Environment]::NewLine, $Utf8) } catch {}
}

function Write-ControlEvent([string]$Model, [int]$Sequence, [int]$AttemptPid) {
  $Provider = Get-ProviderName $Model
  $Line = "[FixUp Scout][control] provider=$Provider model=$Model attempt=$Sequence pid=$AttemptPid state=running"
  Write-Host $Line -ForegroundColor DarkGray
  try { [IO.File]::AppendAllText($AttemptLogFile, $Line + [Environment]::NewLine, $Utf8) } catch {}
}

function Write-DiagnosticEvent([string]$Model, [string]$Classification, [bool]$Fallback, [int]$ExitCode, [string]$Detail) {
  $Provider = Get-ProviderName $Model
  $Progress = "unknown"
  try { $State = Get-FixUpJobStatus; $Progress = "$($State.processedCount)/$($State.totalCount)" } catch {}
  $SafeDetail = ($Detail -replace '[\t\r\n ]+', ' ').Trim()
  if ($SafeDetail.Length -gt 320) { $SafeDetail = $SafeDetail.Substring(0, 320) }
  $ExitLabel = if ($ExitCode -lt 0 -or $Classification -in @("verification_post_failure", "request_or_program", "job_failed")) { "unknown" } else { [string]$ExitCode }
  $BrowserMcp = if ($Classification -eq "browser_unavailable") { "failed" } elseif ($Classification -eq "tool_execution") { "tool_error" } else { "not_detected" }
  $Line = "[FixUp Scout][diag] timestamp=$([DateTime]::UtcNow.ToString('o')) jobId=$JobId jobKind=$ExecutionMode progress=$Progress model=$Model provider=$Provider classification=$Classification fallback=$Fallback processExitCode=$ExitLabel wrapperExitCode=$ExitLabel httpStatus=unknown browserMcp=$BrowserMcp raw=$SafeDetail"
  try { [IO.File]::AppendAllText($AttemptLogFile, $Line + [Environment]::NewLine, $Utf8) } catch {}
}

function Get-AttemptSummary([string]$Model, [string]$Classification, [string]$Detail) {
  $Slash = $Model.IndexOf("/")
  $Label = if ($Slash -ge 0 -and $Slash + 1 -lt $Model.Length) { $Model.Substring($Slash + 1) } else { $Model }
  $Reason = if ($Classification -eq "quota" -and $Detail -match "OpenRouter") { "OpenRouter 일일한도" }
    elseif ($Classification -eq "quota") { "quota" }
    elseif ($Classification -eq "rate_limit") { "429" }
    elseif ($Classification -eq "provider_unavailable" -and $Detail -match "free-tier automation access rejected") { "403/free-tier 제한" }
    elseif ($Classification -eq "provider_unavailable") { "5xx/일시장애" }
    elseif ($Classification -eq "browser_unavailable") { "브라우저/MCP" }
    elseif ($Classification -eq "tool_execution") { "브라우저/도구실행" }
    elseif ($Classification -eq "incomplete") { "미완료" }
    elseif ($Classification -eq "verification_post_failure") { "POST실패" }
    else { $Classification }
  return "$Label=$Reason"
}

function Get-AttemptText([string]$StdoutFile, [string]$StderrFile) {
  $Parts = @()
  foreach ($Path in @($StdoutFile, $StderrFile)) {
    try {
      if (Test-Path -LiteralPath $Path) {
        $Parts += (Get-Content -LiteralPath $Path -Tail 160 -Encoding UTF8 -ErrorAction Stop | Out-String)
      }
    } catch {}
  }
  return ($Parts -join [Environment]::NewLine)
}

function Get-NewAttemptText([string]$Path, [long]$Offset) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) {
      return [pscustomobject]@{ text = ""; length = 0L }
    }
    $Stream = New-Object System.IO.FileStream -ArgumentList @($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $Length = [long]$Stream.Length
      if ($Offset -lt 0 -or $Offset -gt $Length) { $Offset = 0L }
      $null = $Stream.Seek($Offset, [IO.SeekOrigin]::Begin)
      $Reader = New-Object System.IO.StreamReader -ArgumentList @($Stream, $Utf8, $false, 4096, $true)
      try { $Text = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
      return [pscustomobject]@{ text = [string]$Text; length = $Length }
    } finally {
      $Stream.Dispose()
    }
  } catch {
    return [pscustomobject]@{ text = ""; length = $Offset }
  }
}

function Test-QuotaExhaustion([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(freeusagelimiterror|free(?:\\s+\\w+){0,3}\\s+(?:limit|quota|usage)(?:\\s+\\w+){0,4}\\s+(?:reached|exceeded|exhausted)|free usage exceeded|subscribe to go|add credits https://opencode\\.ai/zen|insufficient[_ -]?quota|quota(?:\\s+\\w+){0,4}\\s+(?:exceeded|exhausted|insufficient|reached)|(?:credit|credits|balance)(?:\\s+\\w+){0,4}\\s+(?:exhausted|insufficient|depleted)|(?:monthly|daily|spend|spending)(?:\\s+\\w+){0,5}\\s+(?:limit|quota)(?:\\s+\\w+){0,3}\\s+(?:reached|exceeded|exhausted))'
}
function Test-AuthFailure([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(unauthori[sz]ed|authentication(?:\\s+\\w+){0,3}\\s+(?:failed|required)|invalid(?:\\s+\\w+){0,3}\\s+(?:api[ -]?key|token|credential)|api[ -]?key(?:\\s+\\w+){0,3}\\s+(?:invalid|missing|required)|credential(?:s)?(?:\\s+\\w+){0,3}\\s+(?:invalid|missing|required))'
}
function Test-NonFallbackProgramFailure([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(invalid[_ -]?request|zoderror|(?:invalid|malformed)(?:\\s+\\w+){0,2}\\s+schema|schema(?:\\s+validation)?\\s+(?:error|failed|failure)|validation error|context(?:\\s+length|\\s+window)(?:\\s+\\w+){0,5}\\s+(?:exceed|overflow|too long)|maximum context|too many tokens|invalid tool arguments|tool(?:\\s+call)?(?:\\s+\\w+){0,4}\\s+(?:invalid arguments|schema error|program error)|spawn unknown|mcp(?:\\s+\\w+){0,2}\\s+(?:error|timeout)|POST_FAILED|작업 종류가 일치하지 않습니다|작업 후보가 아닌 계정|이미 실패 처리된 작업)'
}
function Test-SemanticProgress([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?im)^\\[FixUp OpenCode\\] progress=(?:step_start|step_finish|tool_use|text)\\s*$|"type"\\s*:\\s*"(?:step_start|step_finish|tool_use|text)"'
}
function Test-TransientRateLimit([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  if (Test-QuotaExhaustion $Text) { return $false }
  return $Text -match '(?i)(rate[ -]?limit|too many requests|retry-after(?:-ms)?\\s*[:=]|retrying in\\s+\\d|(?:api|provider|model|llm)(?:\\s+\\w+){0,5}\\s+(?:error|status|response)?(?:\\s*[:=])?\\s*429)'
}
function Test-ProviderUnavailable([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(\\b50[0234]\\b|service unavailable|temporarily unavailable|provider unavailable|upstream(?:\\s+\\w+){0,3}\\s+(?:timeout|unavailable)|overloaded|connection (?:reset|refused)|ECONNRESET|ETIMEDOUT|model(?:\\s+\\w+){0,4}\\s+(?:not found|unavailable|unsupported)|unknown model|modelnotfound|OpenCode''s free tier can only be used from within OpenCode)'
}
function Get-RetryAfterSeconds([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }

  $MsMatch = [regex]::Match($Text, '(?i)retry-after-ms\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)')
  if ($MsMatch.Success) {
    $Milliseconds = 0.0
    if ([double]::TryParse($MsMatch.Groups[1].Value, [ref]$Milliseconds)) {
      return [int][Math]::Ceiling($Milliseconds / 1000.0)
    }
  }

  $Patterns = @(
    '(?i)retry-after\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)',
    '(?i)retry after\\s+(\\d+(?:\\.\\d+)?)\\s*(?:s|sec|seconds?)',
    '(?i)retrying in\\s+(\\d+(?:\\.\\d+)?)\\s*(?:s|sec|seconds?)'
  )
  foreach ($Pattern in $Patterns) {
    $Match = [regex]::Match($Text, $Pattern)
    if ($Match.Success) {
      $Value = 0.0
      if ([double]::TryParse($Match.Groups[1].Value, [ref]$Value)) {
        return [int][Math]::Ceiling($Value)
      }
    }
  }
  return $null
}
function Get-FailureClassification([string]$Text, [int]$ExitCode) {
  switch ($ExitCode) {
    181 { return "auth" }
    182 { return "invalid_model" }
    183 { return "malformed_request" }
    184 { return "tool_incompatible" }
    185 { return "timeout" }
    186 { return "rate_limit" }
  }
  if ($Text -match 'FIXUP_LOCAL_permission_denied' -or $ExitCode -eq 177) { return "permission_denied" }
  if ($Text -match 'FIXUP_LOCAL_post_failure' -or $ExitCode -eq 178) { return "post_failure" }
  if ($Text -match 'FIXUP_LOCAL_browser_unavailable' -or $ExitCode -eq 176) { return "browser_unavailable" }
  if ($Text -match 'FIXUP_LOCAL_tool_execution' -or $ExitCode -eq 179) { return "tool_execution" }
  if (Test-QuotaExhaustion $Text) { return "quota" }
  if (Test-TransientRateLimit $Text) { return "rate_limit" }
  if (Test-ProviderUnavailable $Text) { return "provider_unavailable" }
  if (Test-AuthFailure $Text) { return "auth" }
  if (Test-NonFallbackProgramFailure $Text) { return "request_or_program" }
  if ($ExitCode -eq 180) { return "local_execution" }
  if ($ExitCode -eq 173 -or $ExitCode -eq 174) { return "quota" }
  if ($ExitCode -eq 175) { return "provider_unavailable" }
  if ($ExitCode -eq 176) { return "browser_unavailable" }
  if ($ExitCode -eq 0) { return "incomplete" }
  return "other"
}

function Stop-FixUpAttemptTree([int]$TargetPid) {
  if ($TargetPid -le 0) { return }
  try {
    & taskkill.exe /PID $TargetPid /T /F 2>$null | Out-Null
  } catch {
    try { Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Invoke-OpenCodeAttempt([string]$Model, [int]$Sequence) {
  $StdoutFile = Join-Path ([IO.Path]::GetDirectoryName($AttemptLogFile)) ("$JobId.attempt-$Sequence.stdout.log")
  $StderrFile = Join-Path ([IO.Path]::GetDirectoryName($AttemptLogFile)) ("$JobId.attempt-$Sequence.stderr.log")
  Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PostFailureFile -Force -ErrorAction SilentlyContinue

  $AttemptInstruction = $OpenCodeInstruction
  try {
    $ResumeJob = Get-FixUpJobStatus
    if ($ExecutionMode -eq "verification") {
      $RemainingHandles = @($ResumeJob.remainingHandles)
      if ($ResumeJob.status -eq "pending" -and $RemainingHandles.Count -eq 0) {
        return [pscustomobject]@{ classification = "request_or_program"; exitCode = -1; retryAfter = $null; detail = "pending verification job has no remaining handles" }
      }
      $AttemptInstruction += " Exact remaining handles for this attempt: " + [string]::Join(", ", [string[]]$RemainingHandles) + "."
    }
  } catch {
    return [pscustomobject]@{ classification = "request_or_program"; exitCode = -1; retryAfter = $null; detail = "job resume state lookup failed: $($_.Exception.Message)" }
  }

  $env:FIXUP_SCOUT_OPEN_CODE = $OpenCode
  $env:FIXUP_SCOUT_PROMPT_FILE = $PromptFile
  $env:FIXUP_SCOUT_INSTRUCTION = $AttemptInstruction
  $env:FIXUP_SCOUT_AGENT = $OpenCodeAgent
  $env:FIXUP_SCOUT_MODEL = $Model
  $ChildCommand = '$ErrorActionPreference="Stop"; $Utf8=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=$Utf8; $OutputEncoding=$Utf8; try { chcp 65001 > $null } catch {}; ${getOpenCodeVariantArgsScript("$env:FIXUP_SCOUT_MODEL")}; & $env:FIXUP_SCOUT_OPEN_CODE run $env:FIXUP_SCOUT_INSTRUCTION --file $env:FIXUP_SCOUT_PROMPT_FILE --model $env:FIXUP_SCOUT_MODEL --agent $env:FIXUP_SCOUT_AGENT @VariantArgs; $Code=$LASTEXITCODE; if ($null -eq $Code) { $Code=0 }; exit $Code'
  $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

  try {
    $Attempt = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$Encoded) -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput $StdoutFile -RedirectStandardError $StderrFile -PassThru
  } catch {
    return [pscustomobject]@{ classification = "request_or_program"; exitCode = -1; retryAfter = $null; detail = "OpenCode attempt 시작 실패: $($_.Exception.Message)" }
  }

  $null = $Attempt.Handle
  $LastProcessedCount = 0
  try {
    $InitialJob = Get-FixUpJobStatus
    $LastProcessedCount = [int]$InitialJob.processedCount
  } catch {}

  Write-Heartbeat
  Write-ControlEvent $Model $Sequence $Attempt.Id
  Write-Host "[FixUp Scout] supervisor · PID $($Attempt.Id) · wrapper phase supervision" -ForegroundColor DarkGray

  while (-not $Attempt.HasExited) {
    Write-Heartbeat
    Start-Sleep -Seconds $PollSeconds

    $PostFailure = Get-VerificationPostFailure
    if ($null -ne $PostFailure) {
      Stop-FixUpAttemptTree $Attempt.Id
      return [pscustomobject]@{ classification = "verification_post_failure"; exitCode = 409; retryAfter = $null; detail = [string]$PostFailure }
    }

    $Job = $null
    try { $Job = Get-FixUpJobStatus } catch {}
    if ($null -ne $Job -and [int]$Job.processedCount -gt $LastProcessedCount) {
      $LastProcessedCount = [int]$Job.processedCount
    }
    if ($null -ne $Job -and $Job.status -eq "completed") {
      Stop-FixUpAttemptTree $Attempt.Id
      return [pscustomobject]@{ classification = "completed"; exitCode = 0; retryAfter = $null; detail = "job completed" }
    }
    if ($null -ne $Job -and $Job.status -eq "failed") {
      Stop-FixUpAttemptTree $Attempt.Id
      $Detail = if ($Job.failureMessage) { [string]$Job.failureMessage } else { "job failed" }
      return [pscustomobject]@{ classification = "job_failed"; exitCode = -1; retryAfter = $null; detail = $Detail }
    }


  }

  try { $Attempt.WaitForExit() } catch {}
  $Code = -1
  try { $Code = [int]$Attempt.ExitCode } catch {}
  $Text = Get-AttemptText $StdoutFile $StderrFile
  $PostFailure = Get-VerificationPostFailure
  if ($null -ne $PostFailure) {
    return [pscustomobject]@{ classification = "verification_post_failure"; exitCode = 409; retryAfter = $null; detail = [string]$PostFailure }
  }
  $Job = $null
  try { $Job = Get-FixUpJobStatus } catch {}
  $Classification = Get-FailureClassification $Text $Code
  $RetryAfter = if ($Classification -eq "rate_limit") { Get-RetryAfterSeconds $Text } else { $null }
  $Detail = if ($null -ne $Job -and $Job.status -eq "failed" -and $Job.failureMessage) {
    [string]$Job.failureMessage
  } elseif ($Classification -eq "quota" -and $Text -match '(?i)OpenRouter free daily request limit exhausted') {
    "OpenRouter 무료 모델 일일 요청 한도 소진 · 오늘은 자동 건너뜀"
  } elseif ($Classification -eq "quota") {
    "명확한 무료 사용량/quota/credit 소진 응답"
  } elseif ($Classification -eq "rate_limit") {
    "일시적 429/rate limit"
  } elseif ($Classification -eq "auth") {
    "API key/auth 오류"
  } elseif ($Classification -eq "request_or_program") {
    "request/schema/context/tool/program 오류"
  } elseif ($Classification -eq "provider_unavailable" -and $Text -match '(?i)OpenCode''s free tier can only be used from within OpenCode') {
    "OpenCode free-tier automation access rejected (403): can only be used from within OpenCode"
  } elseif ($Classification -eq "provider_unavailable") {
    "provider 5xx/일시 장애"
  } elseif ($Classification -eq "browser_unavailable") {
    "playwright_b/Profile 3 로컬 브라우저 또는 MCP 실행 실패"
  } elseif ($Classification -eq "incomplete") {
    "결과 제출 없이 실행 종료; 로컬 prompt/tool/result 오류 확인 필요 (fallback 금지)"
  } else {
    $LocalDetail = @($Text -split [Environment]::NewLine | Where-Object { $_ -match "^Local execution failure:" } | Select-Object -Last 1)
    "$Classification · exit=$Code · $LocalDetail"
  }

  if ($null -ne $Job -and $Job.status -eq "completed") { $Classification = "completed"; $Detail = "job completed" }
  elseif ($null -ne $Job -and $Job.status -eq "failed") { $Classification = "job_failed" }

  return [pscustomobject]@{ classification = $Classification; exitCode = $Code; retryAfter = $RetryAfter; detail = $Detail }
}

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) { throw "FixUp Scout 프롬프트 파일을 찾을 수 없습니다." }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) { throw "FixUp Scout 프롬프트가 비어 있습니다." }

  Write-Heartbeat
  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  [IO.File]::WriteAllText($AttemptLogFile, "", $Utf8)

  Ensure-PlaywrightBChrome

  $Version = "unknown"
  try { $Version = [string]((& $OpenCode --version 2>$null | Select-Object -First 1)) } catch {}
  Write-Host "[FixUp Scout] ${input.title} · OpenCode 자동 fallback 실행" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] OpenCode $Version" -ForegroundColor DarkGray
  Write-Host "[FixUp Scout] fallback: $($ModelChain -join ' -> ')" -ForegroundColor DarkGray
  Write-Host ""

  $Sequence = 0
  $FinalFailure = $null
  $AttemptFailures = New-Object 'System.Collections.Generic.List[string]'

  for ($Index = 0; $Index -lt $ModelChain.Count; $Index++) {
    $Model = [string]$ModelChain[$Index]
    $Job = Get-FixUpJobStatus
    if ($Job.status -eq "completed") { break }
    if ($Job.status -eq "failed") { throw ([string]$Job.failureMessage) }

    $Processed = if ($Job.processedHandles) { @($Job.processedHandles).Count } else { [int]$Job.processedCount }
    Write-Host "[FixUp Scout] 시도 $($Index + 1)/$($ModelChain.Count) · $Model · 저장 완료 $Processed/$($Job.totalCount)" -ForegroundColor Cyan

    $Sequence += 1
    $Result = Invoke-OpenCodeAttempt $Model $Sequence
    if ($Result.classification -eq "completed") {
      Write-AttemptEvent $Model "completed" $false "동일 job 완료"
      Write-DiagnosticEvent $Model "completed" $false 0 "동일 job 완료"
      break
    }

    $SameModelRetryDelay = -1
    $SameModelRetryReason = ""
    if ($Result.classification -in @("provider_unavailable", "timeout") -and [string]$Result.detail -notmatch "free-tier automation access rejected") {
      $SameModelRetryDelay = 10
      $SameModelRetryReason = "provider transient 5xx/unavailable"
    } elseif ($Result.classification -eq "rate_limit") {
      $Delay = if ($null -ne $Result.retryAfter -and [int]$Result.retryAfter -gt 0) { [int]$Result.retryAfter } else { 10 }
      if ($Delay -le $MaxRetryAfterSeconds) {
        $SameModelRetryDelay = $Delay
        $SameModelRetryReason = "transient rate limit"
      }
    } elseif ($Result.classification -in @("browser_unavailable", "tool_execution", "incomplete")) {
      $SameModelRetryDelay = 2
      $SameModelRetryReason = "fresh local/browser attempt"
    }

    if ($SameModelRetryDelay -ge 0) {
      Write-AttemptEvent $Model ([string]$Result.classification) $false "same-model bounded retry in $SameModelRetryDelay s: $SameModelRetryReason"
      Write-DiagnosticEvent $Model ([string]$Result.classification) $false ([int]$Result.exitCode) "same-model bounded retry in $SameModelRetryDelay s: $SameModelRetryReason"
      if ($Result.classification -in @("browser_unavailable", "tool_execution")) { Ensure-PlaywrightBChrome }
      Start-Sleep -Seconds $SameModelRetryDelay
      $Sequence += 1
      $Result = Invoke-OpenCodeAttempt $Model $Sequence
      if ($Result.classification -eq "completed") {
        Write-AttemptEvent $Model "completed" $false "job completed after one same-model bounded retry"
        Write-DiagnosticEvent $Model "completed" $false 0 "job completed after one same-model bounded retry"
        break
      }
    }

    $Retryable = @("quota", "rate_limit", "provider_unavailable", "browser_unavailable", "tool_execution", "incomplete") -contains [string]$Result.classification
    if ($Result.classification -in @("timeout", "tool_incompatible")) { $Retryable = $true }
    $HasFallback = $Retryable -and ($Index + 1 -lt $ModelChain.Count)
    Write-AttemptEvent $Model ([string]$Result.classification) $HasFallback ([string]$Result.detail)
    Write-DiagnosticEvent $Model ([string]$Result.classification) $HasFallback ([int]$Result.exitCode) ([string]$Result.detail)
    [void]$AttemptFailures.Add((Get-AttemptSummary $Model ([string]$Result.classification) ([string]$Result.detail)))

    if (-not $Retryable) {
      throw "$Model · $($Result.detail)"
    }

    if ($HasFallback) {
      $NextModel = [string]$ModelChain[$Index + 1]
      Write-Host "[FixUp Scout] fallback → $NextModel" -ForegroundColor Yellow
      continue
    }

    $Trace = [string]::Join(" → ", [string[]]$AttemptFailures)
    $FinalFailure = if ([string]::IsNullOrWhiteSpace($Trace)) { "$Model · $($Result.detail)" } else { "fallback 전체 실패 · $Trace" }
  }

  $Job = Get-FixUpJobStatus
  if ($Job.status -ne "completed") {
    $Progress = "$($Job.processedCount)/$($Job.totalCount)"
    if (-not $FinalFailure) { $FinalFailure = "모든 fallback 시도 후에도 job 미완료. 저장 완료 $Progress" }
    if ($Job.status -eq "pending") { $null = Set-FixUpJobFailed $FinalFailure }
    throw $FinalFailure
  }

  Write-Host ""
  Write-Host "[FixUp Scout] 완료 · $($Job.processedCount)/$($Job.totalCount) 결과 저장 확인" -ForegroundColor Green
  Write-Host "이 창은 자동으로 닫히지 않습니다." -ForegroundColor Yellow
  Remove-Item -LiteralPath $HeartbeatFile -ErrorAction SilentlyContinue
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
  Remove-Item -LiteralPath $HeartbeatFile -ErrorAction SilentlyContinue
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
  await launchExitWatcher({
    processId,
    jobId: input.jobId,
    jobKind: input.mode,
    watcherPath,
    watcherLogPath,
    failedPath,
    openCodeLogPath,
  });

  return { command, promptPath, processId, modelChain };
}

async function launchExitWatcher(input: {
  processId: number;
  jobId: string;
  jobKind: "duplicate" | "verification";
  watcherPath: string;
  watcherLogPath: string;
  failedPath: string;
  openCodeLogPath: string;
}) {
  const watcher = `$ErrorActionPreference = "SilentlyContinue"
$TargetPid = ${input.processId}
$JobId = ${psQuote(input.jobId)}
$JobKind = ${psQuote(input.jobKind)}
$JobUrl = "http://localhost:3000/api/automation/job?jobId=$JobId"
$FailedFile = ${psQuote(input.failedPath)}
$AttemptLogFile = ${psQuote(input.openCodeLogPath)}
$WatcherLogFile = ${psQuote(input.watcherLogPath)}

function Get-FixUpJobStatus {
  try { return Invoke-RestMethod -Uri $JobUrl -Method GET -TimeoutSec 10 } catch { return $null }
}

function Set-FixUpJobFailed([string]$Message) {
  $LastError = ""
  for ($Attempt = 1; $Attempt -le 5; $Attempt++) {
    try {
      $Body = @{ jobId = $JobId; error = $Message } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "http://localhost:3000/api/automation/job" -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 10 | Out-Null
      return $true
    } catch {
      $LastError = $_.Exception.Message
      if ($Attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
  }
  try { Add-Content -LiteralPath $WatcherLogFile -Value ([Environment]::NewLine + "$(Get-Date -Format o) failure-status POST failed after 5 attempts: $LastError") -Encoding UTF8 } catch {}
  return $false
}

while ($null -ne (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) {
  $Job = Get-FixUpJobStatus
  if ($null -ne $Job -and $Job.status -ne "pending") { exit 0 }
  Start-Sleep -Seconds 5
}

Start-Sleep -Seconds 2
$Job = Get-FixUpJobStatus
if ($null -ne $Job -and $Job.status -eq "pending") {
  $RecordedFailure = ""
  try { if (Test-Path -LiteralPath $FailedFile) { $RecordedFailure = (Get-Content -LiteralPath $FailedFile -Raw).Trim() } } catch {}
  $LastAttempt = ""
  try { if (Test-Path -LiteralPath $AttemptLogFile) { $LastAttempt = [string](Get-Content -LiteralPath $AttemptLogFile -Tail 1) } } catch {}
  $Message = if (-not [string]::IsNullOrWhiteSpace($RecordedFailure)) {
    $RecordedFailure
  } elseif (-not [string]::IsNullOrWhiteSpace($LastAttempt)) {
    "OpenCode 제어 PowerShell(PID $TargetPid)이 종료되어 fallback을 계속할 수 없습니다. 마지막 기록: $LastAttempt"
  } else {
    "OpenCode 제어 PowerShell(PID $TargetPid)이 종료 기록 없이 사라져 fallback을 계속할 수 없습니다."
  }
  $Progress = "$($Job.processedCount)/$($Job.totalCount)"
  $Model = "unknown"
  $Provider = "unknown"
  $Match = [regex]::Match($LastAttempt, "model=(\S+)")
  if ($Match.Success) { $Model = $Match.Groups[1].Value }
  $ProviderMatch = [regex]::Match($LastAttempt, "provider=(\S+)")
  if ($ProviderMatch.Success) { $Provider = $ProviderMatch.Groups[1].Value }
  $SafeMessage = ($Message -replace "[\t\r\n ]+", " ").Trim()
  if ($SafeMessage.Length -gt 320) { $SafeMessage = $SafeMessage.Substring(0, 320) }
  $Diag = "[FixUp Scout][diag] timestamp=$([DateTime]::UtcNow.ToString('o')) jobId=$JobId jobKind=$JobKind progress=$Progress model=$Model provider=$Provider classification=control_process_lost fallback=False processExitCode=unknown wrapperExitCode=unknown httpStatus=GET_OK browserMcp=unknown raw=$SafeMessage"
  try { [IO.File]::WriteAllText($WatcherLogFile, $Diag, (New-Object System.Text.UTF8Encoding($false))); [IO.File]::AppendAllText($AttemptLogFile, $Diag + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false))) } catch {}
  Set-FixUpJobFailed $Message
}
`;

  await writeFile(input.watcherPath, `\uFEFF${watcher}`, { encoding: "utf8" });
  const watcherCommand = `$p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",${psQuote(input.watcherPath)}) -WindowStyle Hidden -PassThru; [Console]::Out.Write($p.Id)`;
  const started = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-Command", watcherCommand],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    },
  );

  if (started.error || started.status !== 0) {
    const detail = (started.stderr || started.stdout || "").trim();
    console.warn("automation_exit_watcher_start_failed", detail || started.error?.message || "unknown_error");
  }
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

function getBoundedInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
