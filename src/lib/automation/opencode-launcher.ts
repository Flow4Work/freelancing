import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOpenCodeCommand } from "./config";

const DEFAULT_PRIMARY_MODEL = "opencode/muse-spark-1.3-contributor-free";
const DEFAULT_MISTRAL_MODEL = "mistral/mistral-small-latest";
const DEFAULT_NVIDIA_MODEL = "nvidia/minimaxai/minimax-m3";
const DEFAULT_STALL_SECONDS = 75;
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
  const openCodeLogPath = path.join(root, `${input.jobId}.opencode.log`);
  const watcherPath = path.join(root, `${input.jobId}.watch.ps1`);
  const duplicateJob = input.title === "중복 확인";
  const modelChain = [...new Set([
    getEnvModel("FIXUP_OPENCODE_PRIMARY_MODEL", DEFAULT_PRIMARY_MODEL),
    getEnvModel("FIXUP_OPENCODE_MISTRAL_MODEL", DEFAULT_MISTRAL_MODEL),
    getEnvModel("FIXUP_OPENCODE_NVIDIA_MODEL", DEFAULT_NVIDIA_MODEL),
  ])];
  const stallSeconds = getBoundedInteger("FIXUP_OPENCODE_STALL_SECONDS", DEFAULT_STALL_SECONDS, 30, 600);
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
  ]);

  const resumeInstruction = `\n- 이 실행은 provider/model fallback 재개 실행일 수 있다. 시작 직후 http://localhost:3000/api/automation/job?jobId=${input.jobId} 를 GET으로 딱 1회 확인한다.\n- processedHandles에 있는 계정은 이미 Scout 저장이 끝난 결과다. 절대 다시 검사하거나 다시 POST하지 않는다. remaining 계정만 처리한다.\n- processedHandles가 비어 있으면 본문 순서대로 처음부터 정상 실행한다.\n- 이 job 상태 GET은 재개 지점 확인용이며 verification/results GET, 임의 /health 호출, route/code 탐색으로 확장하지 않는다.`;

  const reliabilityInstruction = duplicateJob
    ? `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 중복 확인이다. 본문에 적힌 1차/2차 batch 저장 방식을 그대로 지키며 후보 1명마다 POST하지 않는다.\n- FixUp 전원 판정 → duplicate/protected/unknown 1차 batch → 필요한 available의 Instagram followers만 확인 → available 2차 batch 순서를 바꾸지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 바로 본문의 FixUp 중복 페이지로 이동한다.\n- BIO/Reels/게시물 검증은 하지 않는다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 batch를 다시 처리하지 않는다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.${resumeInstruction}`
    : `\n\n[최우선 실행/저장 안정성]\n- 이 작업은 Instagram 최종 검증이다. 후보 1명 처리가 끝날 때마다 해당 1건을 즉시 localhost 결과 API에 POST하고 ok:true를 확인한 뒤 다음 후보로 간다.\n- 전체 후보를 끝낸 뒤 한 번에 제출하지 않는다.\n- 시작 전에 verification/results GET, 임의 /health 호출, node/port 전수 조사, API route/code 탐색을 하지 않는다. OpenCode가 시작되면 바로 첫 후보 Instagram 프로필로 이동한다.\n- /reels/ 로딩 실패 시 짧게 대기 → 최신 snapshot → 필요하면 같은 /reels/ 1회 재이동 또는 reload까지만 허용한다. 그래도 조회수를 읽지 못하면 reels:[]와 확인 불가 사유를 note에 넣어 즉시 POST하고 다음 후보로 간다.\n- Reels 실패 때문에 network/GraphQL/request body 분석, HTML dump 반복, 다른 후보 Reels 페이지 재방문을 하지 않는다.\n- Python/py/python3, Temp 결과파일, pathlib, --data-binary @파일경로를 사용하지 않는다.\n- POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 후보를 다시 처리하지 않는다.\n- 마지막 POST 응답 completed:true를 확인해야만 전체 완료다.${resumeInstruction}`;

  await writeFile(promptPath, `${input.prompt}${reliabilityInstruction}`, { encoding: "utf8" });

  const openCodeInstruction = duplicateJob
    ? "첨부된 FixUp Scout 작업 지시만 실행해. 재개 상태 GET 1회 뒤 미처리 후보만 처리하고, 본문의 최대 2회 batch POST 구조와 마지막 completed:true 확인을 그대로 지켜."
    : "첨부된 FixUp Scout 작업 지시만 실행해. 재개 상태 GET 1회 뒤 미처리 후보만 처리하고, 후보별 즉시 POST와 마지막 completed:true 확인을 그대로 지켜.";

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
$JobId = ${psQuote(input.jobId)}
$JobUrl = "http://localhost:3000/api/automation/job?jobId=$JobId"
$OpenCodeInstruction = ${psQuote(openCodeInstruction)}
$ModelChain = @(${modelChain.map((model) => psQuote(model)).join(", ")})
$IdleLimitSeconds = ${stallSeconds}
$MaxRetryAfterSeconds = ${maxRetryAfterSeconds}
$PollSeconds = 5

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

function Get-AttemptText([string]$StdoutFile, [string]$StderrFile) {
  $Parts = @()
  foreach ($Path in @($StdoutFile, $StderrFile)) {
    try {
      if (Test-Path -LiteralPath $Path) {
        $Parts += (Get-Content -LiteralPath $Path -Tail 160 -ErrorAction Stop | Out-String)
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
  return $Text -match '(?i)(invalid[_ -]?request|zoderror|schema(?:\\s+validation)?(?:\\s+error)?|validation error|context(?:\\s+length|\\s+window)(?:\\s+\\w+){0,5}\\s+(?:exceed|overflow|too long)|maximum context|too many tokens|invalid tool|tool(?:\\s+call)?(?:\\s+\\w+){0,4}\\s+(?:invalid arguments|schema error|program error)|POST_FAILED|작업 종류가 일치하지 않습니다|작업 후보가 아닌 계정|이미 실패 처리된 작업)'
}
function Test-TransientRateLimit([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  if (Test-QuotaExhaustion $Text) { return $false }
  return $Text -match '(?i)(rate[ -]?limit|too many requests|retry-after(?:-ms)?\\s*[:=]|retrying in\\s+\\d|(?:api|provider|model|llm)(?:\\s+\\w+){0,5}\\s+(?:error|status|response)?(?:\\s*[:=])?\\s*429)'
}
function Test-ProviderUnavailable([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match '(?i)(\\b50[0234]\\b|service unavailable|temporarily unavailable|provider unavailable|upstream(?:\\s+\\w+){0,3}\\s+(?:timeout|unavailable)|overloaded|connection (?:reset|refused)|ECONNRESET|ETIMEDOUT|model(?:\\s+\\w+){0,4}\\s+(?:not found|unavailable|unsupported)|unknown model|modelnotfound)'
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
  if (Test-QuotaExhaustion $Text) { return "quota" }
  if (Test-AuthFailure $Text) { return "auth" }
  if (Test-NonFallbackProgramFailure $Text) { return "request_or_program" }
  if (Test-TransientRateLimit $Text) { return "rate_limit" }
  if (Test-ProviderUnavailable $Text) { return "provider_unavailable" }
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

  $env:FIXUP_SCOUT_OPEN_CODE = $OpenCode
  $env:FIXUP_SCOUT_PROMPT_FILE = $PromptFile
  $env:FIXUP_SCOUT_INSTRUCTION = $OpenCodeInstruction
  $env:FIXUP_SCOUT_MODEL = $Model
  $ChildCommand = '$ErrorActionPreference="Stop"; $Utf8=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=$Utf8; $OutputEncoding=$Utf8; try { chcp 65001 > $null } catch {}; & $env:FIXUP_SCOUT_OPEN_CODE run $env:FIXUP_SCOUT_INSTRUCTION --file $env:FIXUP_SCOUT_PROMPT_FILE --model $env:FIXUP_SCOUT_MODEL; $Code=$LASTEXITCODE; if ($null -eq $Code) { $Code=0 }; exit $Code'
  $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

  try {
    $Attempt = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$Encoded) -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput $StdoutFile -RedirectStandardError $StderrFile -PassThru
  } catch {
    return [pscustomobject]@{ classification = "request_or_program"; exitCode = -1; retryAfter = $null; detail = "OpenCode attempt 시작 실패: $($_.Exception.Message)" }
  }

  $LastActivityAt = [DateTime]::UtcNow
  $StdoutOffset = 0L
  $StderrOffset = 0L
  $RateLimitAt = $null
  $RateLimitRetryAfter = $null

  while (-not $Attempt.HasExited) {
    Start-Sleep -Seconds $PollSeconds

    $Job = $null
    try { $Job = Get-FixUpJobStatus } catch {}
    if ($null -ne $Job -and $Job.status -eq "completed") {
      Stop-FixUpAttemptTree $Attempt.Id
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "completed"; exitCode = 0; retryAfter = $null; detail = "job completed" }
    }
    if ($null -ne $Job -and $Job.status -eq "failed") {
      Stop-FixUpAttemptTree $Attempt.Id
      $Detail = if ($Job.failureMessage) { [string]$Job.failureMessage } else { "job failed" }
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "job_failed"; exitCode = -1; retryAfter = $null; detail = $Detail }
    }

    $StdoutDelta = Get-NewAttemptText $StdoutFile $StdoutOffset
    $StderrDelta = Get-NewAttemptText $StderrFile $StderrOffset
    $StdoutOffset = [long]$StdoutDelta.length
    $StderrOffset = [long]$StderrDelta.length
    $Text = @([string]$StdoutDelta.text, [string]$StderrDelta.text) -join [Environment]::NewLine
    $Changed = -not [string]::IsNullOrEmpty($Text)
    if ($Changed) { $LastActivityAt = [DateTime]::UtcNow }

    if (Test-QuotaExhaustion $Text) {
      Stop-FixUpAttemptTree $Attempt.Id
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "quota"; exitCode = 429; retryAfter = $null; detail = "명확한 무료 사용량/quota/credit 소진 응답" }
    }
    if (Test-AuthFailure $Text) {
      Stop-FixUpAttemptTree $Attempt.Id
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "auth"; exitCode = 401; retryAfter = $null; detail = "API key/auth 오류" }
    }
    if (Test-NonFallbackProgramFailure $Text) {
      Stop-FixUpAttemptTree $Attempt.Id
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "request_or_program"; exitCode = 400; retryAfter = $null; detail = "request/schema/context/tool/program 오류" }
    }

    $CurrentRateLimit = Test-TransientRateLimit $Text
    if ($CurrentRateLimit) {
      if ($null -eq $RateLimitAt) {
        $RateLimitAt = [DateTime]::UtcNow
        $RateLimitRetryAfter = Get-RetryAfterSeconds $Text
      }
    } elseif ($Changed -and $null -ne $RateLimitAt) {
      $RateLimitAt = $null
      $RateLimitRetryAfter = $null
    }

    if ($null -ne $RateLimitAt) {
      $AllowedSeconds = if ($null -ne $RateLimitRetryAfter -and $RateLimitRetryAfter -gt 0 -and $RateLimitRetryAfter -le $MaxRetryAfterSeconds) {
        [Math]::Min($MaxRetryAfterSeconds + 5, $RateLimitRetryAfter + 5)
      } else {
        10
      }
      if (([DateTime]::UtcNow - $RateLimitAt).TotalSeconds -ge $AllowedSeconds) {
        Stop-FixUpAttemptTree $Attempt.Id
        Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ classification = "rate_limit"; exitCode = 429; retryAfter = $RateLimitRetryAfter; detail = "일시적 429/rate limit" }
      }
    }

    if (([DateTime]::UtcNow - $LastActivityAt).TotalSeconds -ge $IdleLimitSeconds) {
      Stop-FixUpAttemptTree $Attempt.Id
      Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ classification = "stall"; exitCode = -1; retryAfter = $null; detail = "transcript/output 활동 ${stallSeconds}초 정지" }
    }
  }

  try { $Attempt.WaitForExit() } catch {}
  $Code = -1
  try { $Code = [int]$Attempt.ExitCode } catch {}
  $Text = Get-AttemptText $StdoutFile $StderrFile
  $Job = $null
  try { $Job = Get-FixUpJobStatus } catch {}
  $Classification = Get-FailureClassification $Text $Code
  $RetryAfter = if ($Classification -eq "rate_limit") { Get-RetryAfterSeconds $Text } else { $null }
  $Detail = if ($null -ne $Job -and $Job.status -eq "failed" -and $Job.failureMessage) {
    [string]$Job.failureMessage
  } elseif ($Classification -eq "quota") {
    "명확한 무료 사용량/quota/credit 소진 응답"
  } elseif ($Classification -eq "rate_limit") {
    "일시적 429/rate limit"
  } elseif ($Classification -eq "auth") {
    "API key/auth 오류"
  } elseif ($Classification -eq "request_or_program") {
    "request/schema/context/tool/program 오류"
  } elseif ($Classification -eq "provider_unavailable") {
    "provider 5xx/일시 장애"
  } elseif ($Classification -eq "incomplete") {
    "OpenCode 정상 종료지만 job 미완료"
  } else {
    "OpenCode 종료 코드 $Code"
  }

  if ($null -ne $Job -and $Job.status -eq "completed") { $Classification = "completed"; $Detail = "job completed" }
  elseif ($null -ne $Job -and $Job.status -eq "failed") { $Classification = "job_failed" }

  Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue
  return [pscustomobject]@{ classification = $Classification; exitCode = $Code; retryAfter = $RetryAfter; detail = $Detail }
}

try {
  $null = Get-Command $OpenCode -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $PromptFile)) { throw "FixUp Scout 프롬프트 파일을 찾을 수 없습니다." }
  if ((Get-Item -LiteralPath $PromptFile).Length -le 0) { throw "FixUp Scout 프롬프트가 비어 있습니다." }

  [IO.File]::WriteAllText($InvokedFile, "invoked", $Utf8)
  [IO.File]::WriteAllText($AttemptLogFile, "", $Utf8)

  $Version = "unknown"
  try { $Version = [string]((& $OpenCode --version 2>$null | Select-Object -First 1)) } catch {}
  Write-Host "[FixUp Scout] ${input.title} · OpenCode 자동 fallback 실행" -ForegroundColor Cyan
  Write-Host "[FixUp Scout] OpenCode $Version" -ForegroundColor DarkGray
  Write-Host "[FixUp Scout] fallback: $($ModelChain -join ' -> ')" -ForegroundColor DarkGray
  Write-Host ""

  $Sequence = 0
  $FinalFailure = $null

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
      break
    }

    if ($Result.classification -eq "rate_limit" -and $null -ne $Result.retryAfter -and [int]$Result.retryAfter -gt 0 -and [int]$Result.retryAfter -le $MaxRetryAfterSeconds) {
      Write-AttemptEvent $Model "rate_limit" $false "Retry-After $($Result.retryAfter)s 경과 후 동일 model 1회만 재시도"
      $Sequence += 1
      $Result = Invoke-OpenCodeAttempt $Model $Sequence
      if ($Result.classification -eq "completed") {
        Write-AttemptEvent $Model "completed" $false "짧은 429 재시도 후 동일 job 완료"
        break
      }
    }

    $Retryable = @("quota", "rate_limit", "stall", "provider_unavailable") -contains [string]$Result.classification
    $HasFallback = $Retryable -and ($Index + 1 -lt $ModelChain.Count)
    Write-AttemptEvent $Model ([string]$Result.classification) $HasFallback ([string]$Result.detail)

    if (-not $Retryable) {
      throw "$Model · $($Result.detail)"
    }

    if ($HasFallback) {
      $NextModel = [string]$ModelChain[$Index + 1]
      Write-Host "[FixUp Scout] fallback → $NextModel" -ForegroundColor Yellow
      continue
    }

    $FinalFailure = "$Model · $($Result.detail)"
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
  await launchExitWatcher({ processId, jobId: input.jobId, watcherPath });

  return { command, promptPath, processId, modelChain };
}

async function launchExitWatcher(input: { processId: number; jobId: string; watcherPath: string }) {
  const watcher = `$ErrorActionPreference = "SilentlyContinue"
$TargetPid = ${input.processId}
$JobId = ${psQuote(input.jobId)}
$JobUrl = "http://localhost:3000/api/automation/job?jobId=$JobId"

function Get-FixUpJobStatus {
  try { return Invoke-RestMethod -Uri $JobUrl -Method GET -TimeoutSec 10 } catch { return $null }
}

function Set-FixUpJobFailed([string]$Message) {
  try {
    $Body = @{ jobId = $JobId; error = $Message } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "http://localhost:3000/api/automation/job" -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 10 | Out-Null
  } catch {}
}

while ($null -ne (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) {
  $Job = Get-FixUpJobStatus
  if ($null -ne $Job -and $Job.status -ne "pending") { exit 0 }
  Start-Sleep -Seconds 5
}

Start-Sleep -Seconds 2
$Job = Get-FixUpJobStatus
if ($null -ne $Job -and $Job.status -eq "pending") {
  Set-FixUpJobFailed "OpenCode fallback 실행 창이 예기치 않게 종료되었습니다."
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

function getEnvModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
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
