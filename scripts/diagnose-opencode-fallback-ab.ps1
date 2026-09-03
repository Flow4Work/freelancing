$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP 'fixup-scout-diagnostic'
$TimeoutSeconds = 90
$MistralModel = 'mistral/mistral-small-2603'
$NvidiaModel = 'nvidia/minimaxai/minimax-m3'

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Set-Location -LiteralPath $Repo

function Get-EnvLocalValue {
    param([Parameter(Mandatory=$true)][string]$Name)

    $ProcessValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($ProcessValue)) { return $ProcessValue.Trim() }

    $EnvFile = Join-Path $Repo '.env.local'
    if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }

    $Pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
    $Line = Get-Content -LiteralPath $EnvFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match $Pattern } |
        Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($Line)) { return $null }

    $Value = ($Line -replace $Pattern, '').Trim()
    if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return $Value
}

$Secrets = @()
foreach ($Name in @('MISTRAL_API_KEY','NVIDIA_API_KEY')) {
    $Value = Get-EnvLocalValue -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        $Secrets += $Value
        if ($Name -eq 'MISTRAL_API_KEY') { $env:MISTRAL_API_KEY = $Value }
        if ($Name -eq 'NVIDIA_API_KEY') { $env:NVIDIA_API_KEY = $Value }
    }
}

if ([string]::IsNullOrWhiteSpace($env:MISTRAL_API_KEY)) { throw 'MISTRAL_API_KEY missing.' }
if ([string]::IsNullOrWhiteSpace($env:NVIDIA_API_KEY)) { throw 'NVIDIA_API_KEY missing.' }

function Redact-Text {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return '' }
    $Safe = $Text
    foreach ($Secret in $Secrets) {
        if (-not [string]::IsNullOrWhiteSpace($Secret)) { $Safe = $Safe.Replace($Secret, '[REDACTED]') }
    }
    return $Safe
}

function Resolve-OpenCodeExecutable {
    $Command = Get-Command opencode -ErrorAction Stop | Select-Object -First 1
    $Source = [string]$Command.Source
    if ($Source -match '(?i)\.exe$' -and (Test-Path -LiteralPath $Source)) { return $Source }

    if (-not [string]::IsNullOrWhiteSpace($Source)) {
        $Candidate = Join-Path (Split-Path -Parent $Source) 'node_modules\opencode-ai\bin\opencode.exe'
        if (Test-Path -LiteralPath $Candidate) { return $Candidate }
    }

    $ExeCommand = Get-Command opencode.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $ExeCommand -and (Test-Path -LiteralPath $ExeCommand.Source)) { return [string]$ExeCommand.Source }
    throw 'Could not resolve opencode.exe.'
}

function Stop-TestTree {
    param([int]$TargetPid)
    if ($TargetPid -le 0) { return }
    try { & taskkill.exe /PID $TargetPid /T /F 2>$null | Out-Null } catch {}
}

function Invoke-OpenCodeRunCaptured {
    param(
        [Parameter(Mandatory=$true)][string]$Tag,
        [Parameter(Mandatory=$true)][string]$Model,
        [Parameter(Mandatory=$true)][string]$Prompt
    )

    if ($Prompt.Contains('"')) { throw 'Diagnostic prompt must not contain double quotes.' }

    $StdoutFile = Join-Path $TempRoot ($Tag + '.stdout.log')
    $StderrFile = Join-Path $TempRoot ($Tag + '.stderr.log')
    Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue

    # Start-Process joins ArgumentList into a Windows command line, so the prompt is explicitly quoted.
    # Model/flags contain no spaces and remain separate argv values.
    $QuotedPrompt = '"' + $Prompt + '"'
    $Process = Start-Process -FilePath $OpenCodeExe `
        -ArgumentList @('run', $QuotedPrompt, '--model', $Model, '--format', 'json') `
        -WorkingDirectory $Repo `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -PassThru

    $TimedOut = -not $Process.WaitForExit($TimeoutSeconds * 1000)
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
    $Stdout = Redact-Text ([string]$Stdout)
    $Stderr = Redact-Text ([string]$Stderr)

    [IO.File]::WriteAllText((Join-Path $TempRoot ($Tag + '.combined.log')), ($Stdout + [Environment]::NewLine + $Stderr), (New-Object Text.UTF8Encoding($false)))

    return [pscustomobject]@{
        Tag = $Tag
        Model = $Model
        ExitCode = $ExitCode
        TimedOut = $TimedOut
        Stdout = $Stdout
        Stderr = $Stderr
        Log = Join-Path $TempRoot ($Tag + '.combined.log')
    }
}

function Get-JsonEvents {
    param([AllowNull()][string]$Text)
    $Events = @()
    if ([string]::IsNullOrWhiteSpace($Text)) { return $Events }
    foreach ($Line in ($Text -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($Line)) { continue }
        try { $Events += ($Line | ConvertFrom-Json -ErrorAction Stop) } catch {}
    }
    return $Events
}

function Get-TextOutput {
    param([object[]]$Events)
    $Parts = @()
    foreach ($Event in $Events) {
        if ([string]$Event.type -eq 'text' -and $null -ne $Event.part -and -not [string]::IsNullOrWhiteSpace([string]$Event.part.text)) {
            $Parts += [string]$Event.part.text
        }
    }
    return ($Parts -join "`n").Trim()
}

function Invoke-A {
    param([string]$Tag, [string]$Model)
    $Result = Invoke-OpenCodeRunCaptured -Tag $Tag -Model $Model -Prompt 'Reply with exactly: OK'
    $Events = @(Get-JsonEvents -Text $Result.Stdout)
    $Text = Get-TextOutput -Events $Events
    $ErrorCount = @($Events | Where-Object { [string]$_.type -eq 'error' }).Count
    $Passed = (-not $Result.TimedOut) -and $Result.ExitCode -eq 0 -and $ErrorCount -eq 0 -and $Text -eq 'OK'
    return [pscustomobject]@{ Passed=$Passed; Text=$Text; EventCount=$Events.Count; ErrorCount=$ErrorCount; Result=$Result }
}

function Invoke-B {
    param([string]$Tag, [string]$Model)
    $Prompt = 'playwright_b의 현재 Chrome 세션만 사용한다. 읽기 전용 Playwright tool call을 정확히 1회 사용해 현재 페이지의 로그인 제목만 읽는다. 클릭 입력 이동 금지. 성공하면 마지막 답변은 B_OK: 다음에 읽은 제목만 한 줄로 출력한다.'
    $Result = Invoke-OpenCodeRunCaptured -Tag $Tag -Model $Model -Prompt $Prompt
    $Events = @(Get-JsonEvents -Text $Result.Stdout)
    $ToolEvents = @($Events | Where-Object { [string]$_.type -eq 'tool_use' })
    $PlaywrightTools = @($ToolEvents | Where-Object { [string]$_.part.tool -match '^playwright_b' })
    $CompletedPlaywright = @($PlaywrightTools | Where-Object { [string]$_.part.state.status -eq 'completed' })
    $Text = Get-TextOutput -Events $Events
    $ErrorCount = @($Events | Where-Object { [string]$_.type -eq 'error' }).Count
    $Passed = (-not $Result.TimedOut) -and $Result.ExitCode -eq 0 -and $ErrorCount -eq 0 -and $ToolEvents.Count -eq 1 -and $CompletedPlaywright.Count -eq 1 -and $Text -match '(?m)^B_OK:\s*\S.+'
    $ToolNames = @($ToolEvents | ForEach-Object { [string]$_.part.tool }) -join ','
    return [pscustomobject]@{ Passed=$Passed; Text=$Text; ToolCount=$ToolEvents.Count; ToolNames=$ToolNames; CompletedPlaywrightCount=$CompletedPlaywright.Count; ErrorCount=$ErrorCount; Result=$Result }
}

function Show-AResult {
    param([string]$Name, $Test)
    Write-Host "$Name=$($Test.Passed) exit=$($Test.Result.ExitCode) timeout=$($Test.Result.TimedOut) events=$($Test.EventCount) errors=$($Test.ErrorCount) text=$($Test.Text) log=$($Test.Result.Log)"
    if (-not [string]::IsNullOrWhiteSpace($Test.Result.Stderr)) {
        Write-Host ($Name + '_STDERR=' + $Test.Result.Stderr.Trim())
    }
}

function Show-BResult {
    param([string]$Name, $Test)
    Write-Host "$Name=$($Test.Passed) exit=$($Test.Result.ExitCode) timeout=$($Test.Result.TimedOut) tools=$($Test.ToolCount) tool_names=$($Test.ToolNames) completed_playwright=$($Test.CompletedPlaywrightCount) errors=$($Test.ErrorCount) text=$($Test.Text) log=$($Test.Result.Log)"
    if (-not [string]::IsNullOrWhiteSpace($Test.Result.Stderr)) {
        Write-Host ($Name + '_STDERR=' + $Test.Result.Stderr.Trim())
    }
}

Write-Host '[FixUp Scout] OpenCode fallback A/B diagnosis' -ForegroundColor Cyan
$Head = (git rev-parse HEAD).Trim()
$OpenCodeExe = Resolve-OpenCodeExecutable
Write-Host "LOCAL_HEAD=$Head"
Write-Host "OPENCODE_EXECUTABLE=$OpenCodeExe"
Write-Host "OPENCODE_VERSION=$((& $OpenCodeExe --version 2>$null | Select-Object -First 1))"
Write-Host "MISTRAL_MODEL_PROVEN_BY_PRIOR_LIST=$MistralModel"
Write-Host "NVIDIA_MODEL_PROVEN_BY_PRIOR_LIST=$NvidiaModel"
Write-Host 'SCOUT_E2E=NOT_RUN'

$OldDisableProject = [Environment]::GetEnvironmentVariable('OPENCODE_DISABLE_PROJECT_CONFIG')
$OldInlineConfig = [Environment]::GetEnvironmentVariable('OPENCODE_CONFIG_CONTENT')

try {
    # 1) Current project config: Mistral via the project's current provider definition.
    Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host "MISTRAL_CURRENT_MODEL=$MistralModel" -ForegroundColor Green
    $CurrentA = Invoke-A -Tag 'mistral-current-A' -Model $MistralModel
    Show-AResult -Name 'MISTRAL_CURRENT_A' -Test $CurrentA
    $CurrentB = $null
    if ($CurrentA.Passed) {
        $CurrentB = Invoke-B -Tag 'mistral-current-B' -Model $MistralModel
        Show-BResult -Name 'MISTRAL_CURRENT_B' -Test $CurrentB
    } else {
        Write-Host 'MISTRAL_CURRENT_B=NOT_RUN_A_FAILED'
    }

    # 2) Native/built-in Mistral: disable only the project config and run the same proven model ID.
    $env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host "MISTRAL_NATIVE_MODEL=$MistralModel" -ForegroundColor Green
    $NativeA = Invoke-A -Tag 'mistral-native-A' -Model $MistralModel
    Show-AResult -Name 'MISTRAL_NATIVE_A' -Test $NativeA
    $NativeB = $null
    if ($NativeA.Passed) {
        $NativeB = Invoke-B -Tag 'mistral-native-B' -Model $MistralModel
        Show-BResult -Name 'MISTRAL_NATIVE_B' -Test $NativeB
    } else {
        Write-Host 'MISTRAL_NATIVE_B=NOT_RUN_A_FAILED'
    }

    $CurrentBPassed = ($null -ne $CurrentB -and $CurrentB.Passed)
    $NativeBPassed = ($null -ne $NativeB -and $NativeB.Passed)

    # 3) NVIDIA only when both Mistral paths fail the actual Playwright B test.
    $NvidiaA = $null
    $NvidiaB = $null
    if (-not $CurrentBPassed -and -not $NativeBPassed) {
        Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
        Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
        Write-Host ''
        Write-Host "NVIDIA_MODEL=$NvidiaModel" -ForegroundColor Green
        $NvidiaA = Invoke-A -Tag 'nvidia-A' -Model $NvidiaModel
        Show-AResult -Name 'NVIDIA_A' -Test $NvidiaA
        if ($NvidiaA.Passed) {
            $NvidiaB = Invoke-B -Tag 'nvidia-B' -Model $NvidiaModel
            Show-BResult -Name 'NVIDIA_B' -Test $NvidiaB
        } else {
            Write-Host 'NVIDIA_B=NOT_RUN_A_FAILED'
        }
    } else {
        Write-Host ''
        Write-Host 'NVIDIA_AB=NOT_RUN_MISTRAL_B_ALREADY_PASSED' -ForegroundColor Yellow
    }

    Write-Host ''
    if ($NativeBPassed) {
        Write-Host "AB_RESULT=MISTRAL_NATIVE_PASS model=$MistralModel" -ForegroundColor Green
    } elseif ($CurrentBPassed) {
        Write-Host "AB_RESULT=MISTRAL_CURRENT_PASS model=$MistralModel" -ForegroundColor Green
    } elseif ($null -ne $NvidiaB -and $NvidiaB.Passed) {
        Write-Host "AB_RESULT=NVIDIA_PASS model=$NvidiaModel" -ForegroundColor Green
    } else {
        Write-Host 'AB_RESULT=NO_PROVIDER_PASSED' -ForegroundColor Red
    }
    Write-Host 'SCOUT_E2E=NOT_RUN'
    Write-Host "DIAGNOSTIC_LOG_DIR=$TempRoot"
}
finally {
    if ([string]::IsNullOrWhiteSpace($OldDisableProject)) { Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue } else { $env:OPENCODE_DISABLE_PROJECT_CONFIG = $OldDisableProject }
    if ([string]::IsNullOrWhiteSpace($OldInlineConfig)) { Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue } else { $env:OPENCODE_CONFIG_CONTENT = $OldInlineConfig }
}
