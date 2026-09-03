$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP 'fixup-scout-diagnostic'
$TimeoutSeconds = 60

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

$Secrets = @()
foreach ($Name in @('MISTRAL_API_KEY','NVIDIA_API_KEY','FIXUP_DUPLICATE_LOGIN_ID','FIXUP_DUPLICATE_LOGIN_PASSWORD')) {
    $Value = Get-EnvLocalValue -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        $Secrets += $Value
        if ($Name -eq 'MISTRAL_API_KEY') { $env:MISTRAL_API_KEY = $Value }
        if ($Name -eq 'NVIDIA_API_KEY') { $env:NVIDIA_API_KEY = $Value }
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

function Show-ExistingLog {
    param([Parameter(Mandatory=$true)][string]$Name)

    $Path = Join-Path $TempRoot $Name
    Write-Host ''
    Write-Host "EXISTING_LOG=$Path" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host 'EXISTING_LOG_STATUS=NOT_FOUND' -ForegroundColor Yellow
        return
    }

    $Text = ''
    try { $Text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop } catch { $Text = $_.Exception.Message }
    $Text = Redact-Text $Text
    Write-Host 'EXISTING_LOG_STATUS=FOUND'
    Write-Host 'EXISTING_LOG_CONTENT_BEGIN'
    if ([string]::IsNullOrWhiteSpace($Text)) { Write-Host '<EMPTY>' } else { Write-Host $Text.TrimEnd() }
    Write-Host 'EXISTING_LOG_CONTENT_END'
}

function Invoke-OpenCodeCaptured {
    param(
        [Parameter(Mandatory=$true)][string]$Tag,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [int]$TimeoutSec = 60
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
    $Stdout = Redact-Text ([string]$Stdout)
    $Stderr = Redact-Text ([string]$Stderr)

    $Combined = $Stdout + [Environment]::NewLine + $Stderr
    [IO.File]::WriteAllText((Join-Path $TempRoot ($Tag + '.combined.log')), $Combined, (New-Object Text.UTF8Encoding($false)))
    Remove-Item Env:FIXUP_DIAG_ARGS -ErrorAction SilentlyContinue

    return [pscustomobject]@{
        Tag = $Tag
        ExitCode = $ExitCode
        TimedOut = $TimedOut
        Stdout = $Stdout
        Stderr = $Stderr
        Combined = $Combined
    }
}

function Show-Result {
    param([Parameter(Mandatory=$true)]$Result)

    Write-Host ''
    Write-Host "COMMAND_TAG=$($Result.Tag)" -ForegroundColor Cyan
    Write-Host "EXIT_CODE=$($Result.ExitCode)"
    Write-Host "TIMED_OUT=$($Result.TimedOut)"
    Write-Host 'STDOUT_BEGIN'
    if ([string]::IsNullOrWhiteSpace($Result.Stdout)) { Write-Host '<EMPTY>' } else { Write-Host $Result.Stdout.TrimEnd() }
    Write-Host 'STDOUT_END'
    Write-Host 'STDERR_BEGIN'
    if ([string]::IsNullOrWhiteSpace($Result.Stderr)) { Write-Host '<EMPTY>' } else { Write-Host $Result.Stderr.TrimEnd() }
    Write-Host 'STDERR_END'
}

function Get-ModelIds {
    param([string]$Text, [string]$Provider)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $Matches = [regex]::Matches($Text, '(?im)^\s*' + [regex]::Escape($Provider) + '/([^\s]+)\s*$')
    return @($Matches | ForEach-Object { ($Provider + '/' + $_.Groups[1].Value).Trim() } | Sort-Object -Unique)
}

function Show-ModelSummary {
    param([string]$Name, [string[]]$Ids)
    Write-Host ($Name + '=' + $(if ($Ids.Count -gt 0) { $Ids -join ',' } else { 'NONE' }))
}

Write-Host '[FixUp Scout] model-list diagnosis (NO --refresh)' -ForegroundColor Green
$Head = (git rev-parse HEAD).Trim()
Write-Host "LOCAL_HEAD=$Head"
$Version = (& opencode --version 2>$null | Select-Object -First 1)
Write-Host "OPENCODE_VERSION=$Version"
Write-Host ('MISTRAL_KEY_PRESENT=' + (-not [string]::IsNullOrWhiteSpace($env:MISTRAL_API_KEY)))
Write-Host ('NVIDIA_KEY_PRESENT=' + (-not [string]::IsNullOrWhiteSpace($env:NVIDIA_API_KEY)))

# First expose the exact errors from the previous --refresh based diagnosis.
Show-ExistingLog -Name 'mistral-current-models.combined.log'
Show-ExistingLog -Name 'mistral-native-models.combined.log'
Show-ExistingLog -Name 'nvidia-native-models.combined.log'

$OldDisableProject = [Environment]::GetEnvironmentVariable('OPENCODE_DISABLE_PROJECT_CONFIG')
$OldInlineConfig = [Environment]::GetEnvironmentVariable('OPENCODE_CONFIG_CONTENT')

try {
    # 1) Production/current project config Mistral. Deliberately NO --refresh.
    Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    $CurrentMistral = Invoke-OpenCodeCaptured -Tag 'mistral-current-models-no-refresh' -Arguments @('models','mistral') -TimeoutSec $TimeoutSeconds
    Show-Result $CurrentMistral
    $CurrentMistralIds = Get-ModelIds -Text $CurrentMistral.Stdout -Provider 'mistral'
    Show-ModelSummary -Name 'MISTRAL_CURRENT_MODELS' -Ids $CurrentMistralIds

    # 2) Built-in/native catalog only. Deliberately NO project config and NO --refresh.
    $env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    $NativeMistral = Invoke-OpenCodeCaptured -Tag 'mistral-native-models-no-refresh' -Arguments @('models','mistral') -TimeoutSec $TimeoutSeconds
    Show-Result $NativeMistral
    $NativeMistralIds = Get-ModelIds -Text $NativeMistral.Stdout -Provider 'mistral'
    Show-ModelSummary -Name 'MISTRAL_NATIVE_MODELS' -Ids $NativeMistralIds

    # 3) NVIDIA as production actually sees it: restore project config first.
    Remove-Item Env:OPENCODE_DISABLE_PROJECT_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
    $CurrentNvidia = Invoke-OpenCodeCaptured -Tag 'nvidia-current-models-no-refresh' -Arguments @('models','nvidia') -TimeoutSec $TimeoutSeconds
    Show-Result $CurrentNvidia
    $CurrentNvidiaIds = Get-ModelIds -Text $CurrentNvidia.Stdout -Provider 'nvidia'
    Show-ModelSummary -Name 'NVIDIA_MODELS' -Ids $CurrentNvidiaIds

    $AnyModel = ($CurrentMistralIds.Count -gt 0) -or ($NativeMistralIds.Count -gt 0) -or ($CurrentNvidiaIds.Count -gt 0)
    Write-Host ''
    if ($AnyModel) {
        Write-Host 'MODEL_LOOKUP_RESULT=PASS_AT_LEAST_ONE_PROVIDER' -ForegroundColor Green
        Write-Host 'AB_TEST=NOT_RUN_IN_THIS_STEP' -ForegroundColor Yellow
        Write-Host 'NEXT=Run A/B only against the model IDs proven above. Do not run Scout E2E yet.'
    } else {
        Write-Host 'MODEL_LOOKUP_RESULT=FAIL_ALL_PROVIDERS' -ForegroundColor Red
        Write-Host 'AB_TEST=NOT_RUN'
        Write-Host 'NEXT=Use the printed exit code/stdout/stderr as the actual failure evidence before changing any provider config.'
    }
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

Write-Host "DIAGNOSTIC_LOG_DIR=$TempRoot"
