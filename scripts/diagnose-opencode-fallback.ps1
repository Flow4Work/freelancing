$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$BaseHead = '580bb6da5a735a14787ada43eedfec38bc7d165a'
$TempRoot = Join-Path $env:TEMP 'fixup-scout-diagnostic'
$RuntimeRoot = Join-Path $env:TEMP 'fixup-scout'
$TimeoutSeconds = 90

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Set-Location -LiteralPath $Repo

function Get-EnvLocalValue {
    param([Parameter(Mandatory=$true)][string]$Name)

    $ProcessValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($ProcessValue)) {
        return $ProcessValue.Trim()
    }

    $EnvFile = Join-Path $Repo '.env.local'
    if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }

    $Pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
    $Line = Get-Content -LiteralPath $EnvFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match $Pattern } |
        Select-Object -Last 1

    if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
    $Value = ($Line -replace $Pattern, '').Trim()
    if (
        ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
        ($Value.StartsWith("'") -and $Value.EndsWith("'"))
    ) {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return $Value
}

$SecretNames = @(
    'MISTRAL_API_KEY',
    'NVIDIA_API_KEY',
    'FIXUP_DUPLICATE_LOGIN_ID',
    'FIXUP_DUPLICATE_LOGIN_PASSWORD'
)
$Secrets = @()
foreach ($SecretName in $SecretNames) {
    $SecretValue = Get-EnvLocalValue -Name $SecretName
    if (-not [string]::IsNullOrWhiteSpace($SecretValue)) {
        $Secrets += $SecretValue
        if ($SecretName -eq 'MISTRAL_API_KEY') { $env:MISTRAL_API_KEY = $SecretValue }
        if ($SecretName -eq 'NVIDIA_API_KEY') { $env:NVIDIA_API_KEY = $SecretValue }
    }
}

function Redact-Text {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return '' }
    $Safe = $Text
    foreach ($Secret in $Secrets) {
        if (-not [string]::IsNullOrWhiteSpace($Secret)) {
            $Safe = $Safe.Replace($Secret, '[REDACTED]')
        }
    }
    return $Safe
}

function Stop-TestTree {
    param([int]$TargetPid)
    if ($TargetPid -le 0) { return }
    try {
        & taskkill.exe /PID $TargetPid /T /F 2>$null | Out-Null
    }
    catch {
        try { Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Invoke-OpenCodeCaptured {
    param(
        [Parameter(Mandatory=$true)][string]$Tag,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [int]$TimeoutSec = 90
    )

    $StdoutFile = Join-Path $TempRoot ($Tag + '.stdout.log')
    $StderrFile = Join-Path $TempRoot ($Tag + '.stderr.log')
    Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue

    $ArgsJson = $Arguments | ConvertTo-Json -Compress
    $env:FIXUP_DIAG_ARGS = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ArgsJson))
    $ChildCommand = '$ErrorActionPreference="Continue"; $json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FIXUP_DIAG_ARGS)); $a=@($json | ConvertFrom-Json); & opencode @a; $c=$LASTEXITCODE; if ($null -eq $c) { $c=0 }; exit $c'
    $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

    $Process = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$Encoded) `
        -WorkingDirectory $Repo `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -PassThru

    $TimedOut = -not $Process.WaitForExit($TimeoutSec * 1000)
    if ($TimedOut) {
        Stop-TestTree -TargetPid $Process.Id
        try { $Process.WaitForExit(5000) | Out-Null } catch {}
    }

    $ExitCode = -1
    if (-not $TimedOut) {
        try { $ExitCode = [int]$Process.ExitCode } catch {}
    }

    $Stdout = if (Test-Path -LiteralPath $StdoutFile) { Get-Content -LiteralPath $StdoutFile -Raw -ErrorAction SilentlyContinue } else { '' }
    $Stderr = if (Test-Path -LiteralPath $StderrFile) { Get-Content -LiteralPath $StderrFile -Raw -ErrorAction SilentlyContinue } else { '' }
    $Text = Redact-Text (([string]$Stdout) + [Environment]::NewLine + ([string]$Stderr))
    [IO.File]::WriteAllText((Join-Path $TempRoot ($Tag + '.combined.log')), $Text, (New-Object Text.UTF8Encoding($false)))

    Remove-Item Env:FIXUP_DIAG_ARGS -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Tag = $Tag
        ExitCode = $ExitCode
        TimedOut = $TimedOut
        Text = $Text
        Log = Join-Path $TempRoot ($Tag + '.combined.log')
    }
}

function Get-ModelIds {
    param([string]$Text, [string]$Provider)
    $Matches = [regex]::Matches($Text, '(?im)^\s*' + [regex]::Escape($Provider) + '/([^\s]+)')
    return @($Matches | ForEach-Object { ($Provider + '/' + $_.Groups[1].Value).Trim() } | Sort-Object -Unique)
}

function Select-MistralModel {
    param([string[]]$Ids)
    if ($Ids -contains 'mistral/mistral-small-2603') { return 'mistral/mistral-small-2603' }
    if ($Ids -contains 'mistral/mistral-small-latest') { return 'mistral/mistral-small-latest' }
    return $null
}

function Select-NvidiaModel {
    param([string[]]$Ids)
    if ($Ids -contains 'nvidia/minimaxai/minimax-m3') { return 'nvidia/minimaxai/minimax-m3' }
    return $null
}

function Invoke-A {
    param([string]$Tag, [string]$Model)
    $Result = Invoke-OpenCodeCaptured -Tag $Tag -Arguments @('run','Reply with exactly: OK','--model',$Model) -TimeoutSec $TimeoutSeconds
    $Passed = (-not $Result.TimedOut) -and $Result.ExitCode -eq 0 -and $Result.Text -match '(?m)^\s*OK\s*$'
    return [pscustomobject]@{ Passed = $Passed; Result = $Result }
}

function Invoke-B {
    param([string]$Tag, [string]$Model)
    $Prompt = 'playwright_b의 현재 Chrome 세션만 사용한다. 읽기 전용 Playwright tool call을 정확히 1회 사용해 현재 페이지의 로그인 제목만 읽어 반환한다. 클릭/입력/이동 금지. 실제 tool call이 성공한 경우에만 마지막 줄을 B_OK: <읽은 제목> 형식으로 출력한다. tool을 호출할 수 없거나 실패하면 B_FAIL만 출력한다.'
    $Result = Invoke-OpenCodeCaptured -Tag $Tag -Arguments @('run',$Prompt,'--model',$Model) -TimeoutSec $TimeoutSeconds
    $HasMarker = $Result.Text -match '(?im)^\s*B_OK\s*:'
    $HasToolEvidence = $Result.Text -match '(?i)(playwright[_-]?b|playwright.*browser|browser_(?:snapshot|evaluate)|browser snapshot)'
    $Passed = (-not $Result.TimedOut) -and $Result.ExitCode -eq 0 -and $HasMarker -and $HasToolEvidence
    return [pscustomobject]@{ Passed = $Passed; HasToolEvidence = $HasToolEvidence; Result = $Result }
}

Write-Host '[FixUp Scout] OpenCode fallback 진단 시작' -ForegroundColor Cyan
Write-Host ''

$Head = (git rev-parse HEAD).Trim()
Write-Host "LOCAL_HEAD=$Head"

$PromptChanged = $true
git diff --quiet $BaseHead HEAD -- 'src/lib/discovery/duplicate-prompt.ts'
if ($LASTEXITCODE -eq 0) { $PromptChanged = $false }
Write-Host ('DUPLICATE_PROMPT=' + $(if ($PromptChanged) { 'CHANGED' } else { 'IDENTICAL_TO_580bb6d' }))

$PriorLogs = @()
if (Test-Path -LiteralPath $RuntimeRoot) {
    $PriorLogs = @(Get-ChildItem -LiteralPath $RuntimeRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\.attempt-\d+\.(stdout|stderr)\.log$' } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 4)
}
if ($PriorLogs.Count -gt 0) {
    $PriorCombined = ($PriorLogs | ForEach-Object {
        try { Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop } catch { '' }
    }) -join [Environment]::NewLine
    $PriorCombined = Redact-Text $PriorCombined
    $ThinkingHits = ([regex]::Matches($PriorCombined, '(?i)(thinking|reasoning)')).Count
    $PlaywrightHits = ([regex]::Matches($PriorCombined, '(?i)(playwright|browser_)')).Count
    Write-Host "PRIOR_ATTEMPT_LOGS=FOUND thinking_or_reasoning_hits=$ThinkingHits playwright_hits=$PlaywrightHits"
    [IO.File]::WriteAllText((Join-Path $TempRoot 'prior-attempt-tail.log'), $PriorCombined, (New-Object Text.UTF8Encoding($false)))
} else {
    Write-Host 'PRIOR_ATTEMPT_LOGS=NOT_FOUND'
}

if ([string]::IsNullOrWhiteSpace($env:MISTRAL_API_KEY)) {
    throw 'MISTRAL_API_KEY가 현재 환경/.env.local에 없습니다.'
}
if ([string]::IsNullOrWhiteSpace($env:NVIDIA_API_KEY)) {
    throw 'NVIDIA_API_KEY가 현재 환경/.env.local에 없습니다.'
}

$Version = (& opencode --version 2>$null | Select-Object -First 1)
Write-Host "OPENCODE_VERSION=$Version"

$OldDisableProject = [Environment]::GetEnvironmentVariable('OPENCODE_DISABLE_PROJECT_CONFIG')
$OldInlineConfig = [Environment]::GetEnvironmentVariable('OPENCODE_CONFIG_CONTENT')

try {
    # 1) 현재 프로젝트 설정(OpenAI-compatible Mistral bridge) 실제 목록/A/B
    Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue

    $BridgeModels = Invoke-OpenCodeCaptured -Tag 'mistral-current-models' -Arguments @('models','mistral','--refresh','--verbose') -TimeoutSec 60
    $BridgeIds = Get-ModelIds -Text $BridgeModels.Text -Provider 'mistral'
    $BridgeModel = Select-MistralModel -Ids $BridgeIds
    Write-Host ('MISTRAL_CURRENT_MODELS=' + ($BridgeIds -join ','))
    Write-Host ('MISTRAL_CURRENT_SELECTED=' + $(if ($BridgeModel) { $BridgeModel } else { 'NONE' }))

    $BridgeA = $null
    $BridgeB = $null
    if ($BridgeModel) {
        $BridgeA = Invoke-A -Tag 'mistral-current-A' -Model $BridgeModel
        Write-Host "MISTRAL_CURRENT_A=$($BridgeA.Passed) log=$($BridgeA.Result.Log)"
        if ($BridgeA.Passed) {
            $BridgeB = Invoke-B -Tag 'mistral-current-B' -Model $BridgeModel
            Write-Host "MISTRAL_CURRENT_B=$($BridgeB.Passed) tool_evidence=$($BridgeB.HasToolEvidence) log=$($BridgeB.Result.Log)"
        }
    }

    # 2) OpenCode 1.18.x built-in/native Mistral catalog/provider만 사용해 실제 목록/A/B
    $env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue

    $NativeModels = Invoke-OpenCodeCaptured -Tag 'mistral-native-models' -Arguments @('models','mistral','--refresh','--verbose') -TimeoutSec 60
    $NativeIds = Get-ModelIds -Text $NativeModels.Text -Provider 'mistral'
    $NativeModel = Select-MistralModel -Ids $NativeIds
    Write-Host ('MISTRAL_NATIVE_MODELS=' + ($NativeIds -join ','))
    Write-Host ('MISTRAL_NATIVE_SELECTED=' + $(if ($NativeModel) { $NativeModel } else { 'NONE' }))

    $NativeA = $null
    $NativeB = $null
    if ($NativeModel) {
        $NativeA = Invoke-A -Tag 'mistral-native-A' -Model $NativeModel
        Write-Host "MISTRAL_NATIVE_A=$($NativeA.Passed) log=$($NativeA.Result.Log)"
        if ($NativeA.Passed) {
            $NativeB = Invoke-B -Tag 'mistral-native-B' -Model $NativeModel
            Write-Host "MISTRAL_NATIVE_B=$($NativeB.Passed) tool_evidence=$($NativeB.HasToolEvidence) log=$($NativeB.Result.Log)"
        }
    }

    $MistralUsable = $false
    $MistralMode = 'NONE'
    $MistralChosen = $null
    if ($null -ne $NativeB -and $NativeB.Passed) {
        $MistralUsable = $true
        $MistralMode = 'NATIVE'
        $MistralChosen = $NativeModel
    } elseif ($null -ne $BridgeB -and $BridgeB.Passed) {
        $MistralUsable = $true
        $MistralMode = 'CURRENT_BRIDGE'
        $MistralChosen = $BridgeModel
    }

    $NvidiaA = $null
    $NvidiaB = $null
    $NvidiaModel = $null
    if (-not $MistralUsable) {
        $NvidiaModels = Invoke-OpenCodeCaptured -Tag 'nvidia-native-models' -Arguments @('models','nvidia','--refresh','--verbose') -TimeoutSec 60
        $NvidiaIds = Get-ModelIds -Text $NvidiaModels.Text -Provider 'nvidia'
        $NvidiaModel = Select-NvidiaModel -Ids $NvidiaIds
        Write-Host ('NVIDIA_MODELS=' + ($NvidiaIds -join ','))
        Write-Host ('NVIDIA_SELECTED=' + $(if ($NvidiaModel) { $NvidiaModel } else { 'NONE' }))
        if ($NvidiaModel) {
            $NvidiaA = Invoke-A -Tag 'nvidia-A' -Model $NvidiaModel
            Write-Host "NVIDIA_A=$($NvidiaA.Passed) log=$($NvidiaA.Result.Log)"
            if ($NvidiaA.Passed) {
                $NvidiaB = Invoke-B -Tag 'nvidia-B' -Model $NvidiaModel
                Write-Host "NVIDIA_B=$($NvidiaB.Passed) tool_evidence=$($NvidiaB.HasToolEvidence) log=$($NvidiaB.Result.Log)"
            }
        }
    }

    Write-Host ''
    if ($MistralUsable) {
        Write-Host "DIAGNOSIS=MISTRAL_AB_PASS mode=$MistralMode model=$MistralChosen" -ForegroundColor Green
        Write-Host 'NEXT=Scout prompt/실행 흐름 또는 long-horizon progress 문제를 확인해야 함. 아직 production 수정/E2E 완료 아님.' -ForegroundColor Yellow
    } elseif ($null -ne $NvidiaB -and $NvidiaB.Passed) {
        Write-Host "DIAGNOSIS=MISTRAL_TOOL_PATH_FAIL_NVIDIA_PASS model=$NvidiaModel" -ForegroundColor Yellow
        Write-Host 'NEXT=fallback에서 Mistral 제외 또는 뒤로 이동 검토. 아직 production 수정/E2E 완료 아님.' -ForegroundColor Yellow
    } else {
        Write-Host 'DIAGNOSIS=NO_FALLBACK_PROVIDER_PASSED_AB' -ForegroundColor Red
        Write-Host 'NEXT=provider/auth/model/tool 연결부터 해결. 아직 Scout E2E 실행 금지.' -ForegroundColor Red
    }

    Write-Host "DIAGNOSTIC_LOG_DIR=$TempRoot"
}
finally {
    if ([string]::IsNullOrWhiteSpace($OldDisableProject)) {
        Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
    } else {
        $env:OPENCODE_DISABLE_PROJECT_CONFIG = $OldDisableProject
    }
    if ([string]::IsNullOrWhiteSpace($OldInlineConfig)) {
        Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    } else {
        $env:OPENCODE_CONFIG_CONTENT = $OldInlineConfig
    }
}
