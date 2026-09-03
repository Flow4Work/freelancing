$ErrorActionPreference = 'Stop'

$PrimaryModel = if ([string]::IsNullOrWhiteSpace($env:FIXUP_OPENCODE_PRIMARY_MODEL)) {
    'opencode/muse-spark-1.2-contributor-free'
} else {
    $env:FIXUP_OPENCODE_PRIMARY_MODEL.Trim()
}

$InitialSilenceSeconds = 15
$QuotaCooldownMinutes = 60
$SilenceCooldownMinutes = 10

if ($env:FIXUP_OPENCODE_PRIMARY_INITIAL_SILENCE_SECONDS -match '^\d+$') {
    $InitialSilenceSeconds = [Math]::Max(5, [Math]::Min(60, [int]$env:FIXUP_OPENCODE_PRIMARY_INITIAL_SILENCE_SECONDS))
}
if ($env:FIXUP_OPENCODE_QUOTA_COOLDOWN_MINUTES -match '^\d+$') {
    $QuotaCooldownMinutes = [Math]::Max(5, [Math]::Min(1440, [int]$env:FIXUP_OPENCODE_QUOTA_COOLDOWN_MINUTES))
}
if ($env:FIXUP_OPENCODE_SILENCE_COOLDOWN_MINUTES -match '^\d+$') {
    $SilenceCooldownMinutes = [Math]::Max(1, [Math]::Min(120, [int]$env:FIXUP_OPENCODE_SILENCE_COOLDOWN_MINUTES))
}

function Resolve-RealOpenCode {
    foreach ($Name in @('opencode.exe', 'opencode.cmd', 'opencode.ps1')) {
        $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $Command -and -not [string]::IsNullOrWhiteSpace($Command.Source)) {
            return $Command.Source
        }
    }
    throw '실제 OpenCode 실행 파일을 찾지 못했습니다.'
}

function Stop-ChildTree([int]$TargetPid) {
    if ($TargetPid -le 0) { return }
    try {
        & taskkill.exe /PID $TargetPid /T /F 2>$null | Out-Null
    }
    catch {
        try { Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Get-NewText([string]$Path, [long]$Offset) {
    try {
        if (-not (Test-Path -LiteralPath $Path)) {
            return [pscustomobject]@{ Text = ''; Length = 0L }
        }

        $Stream = New-Object System.IO.FileStream -ArgumentList @(
            $Path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite
        )
        try {
            $Length = [long]$Stream.Length
            if ($Offset -lt 0 -or $Offset -gt $Length) { $Offset = 0L }
            $null = $Stream.Seek($Offset, [IO.SeekOrigin]::Begin)
            $Reader = New-Object System.IO.StreamReader -ArgumentList @($Stream, [Text.Encoding]::UTF8, $true, 4096, $true)
            try { $Text = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
            return [pscustomobject]@{ Text = [string]$Text; Length = $Length }
        }
        finally {
            $Stream.Dispose()
        }
    }
    catch {
        return [pscustomobject]@{ Text = ''; Length = $Offset }
    }
}

function Test-QuotaExhaustion([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(freeusagelimiterror|free(?:\s+\w+){0,3}\s+(?:limit|quota|usage)(?:\s+\w+){0,4}\s+(?:reached|exceeded|exhausted)|free usage exceeded|subscribe to go|add credits https://opencode\.ai/zen|insufficient[_ -]?quota|quota(?:\s+\w+){0,4}\s+(?:exceeded|exhausted|insufficient|reached)|(?:credit|credits|balance)(?:\s+\w+){0,4}\s+(?:exhausted|insufficient|depleted)|(?:monthly|daily|spend|spending)(?:\s+\w+){0,5}\s+(?:limit|quota)(?:\s+\w+){0,3}\s+(?:reached|exceeded|exhausted))'
}

function Get-MeaningfulText([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $Clean = $Text -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
    $Clean = $Clean -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ''
    return $Clean.Trim()
}

$Root = Join-Path $env:TEMP 'fixup-scout'
if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
}
$CircuitFile = Join-Path $Root 'opencode-primary-circuit.json'

function Get-Circuit {
    if (-not (Test-Path -LiteralPath $CircuitFile)) { return $null }
    try {
        $Raw = Get-Content -LiteralPath $CircuitFile -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
        return $Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Set-Circuit([string]$Reason, [int]$Minutes) {
    $State = [pscustomobject]@{
        model = $PrimaryModel
        reason = $Reason
        expiresAt = [DateTime]::UtcNow.AddMinutes($Minutes).ToString('o')
    }
    $Json = $State | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($CircuitFile, $Json, (New-Object Text.UTF8Encoding($false)))
}

function Clear-Circuit {
    Remove-Item -LiteralPath $CircuitFile -Force -ErrorAction SilentlyContinue
}

function Get-OpenCircuit {
    $State = Get-Circuit
    if ($null -eq $State) { return $null }
    if ([string]$State.model -ne $PrimaryModel) {
        Clear-Circuit
        return $null
    }

    $Expires = [DateTime]::MinValue
    if (-not [DateTime]::TryParse([string]$State.expiresAt, [ref]$Expires)) {
        Clear-Circuit
        return $null
    }

    if ($Expires.ToUniversalTime() -le [DateTime]::UtcNow) {
        Clear-Circuit
        return $null
    }
    return $State
}

$RealOpenCode = Resolve-RealOpenCode
$Arguments = @($args)
$Model = $null
for ($i = 0; $i -lt $Arguments.Count - 1; $i++) {
    if ([string]$Arguments[$i] -eq '--model') {
        $Model = [string]$Arguments[$i + 1]
        break
    }
}

$IsRun = $Arguments.Count -gt 0 -and [string]$Arguments[0] -eq 'run'
$IsPrimaryRun = $IsRun -and $Model -eq $PrimaryModel

# Fallback models proved they can call MCP tools only when OpenCode auto-approves
# permissions. Keep the primary Spark path unchanged; add the public --auto flag
# only to non-primary FixUp Scout run attempts.
if ($IsRun -and -not $IsPrimaryRun) {
    $HasAutoApproval = ($Arguments -contains '--auto') -or ($Arguments -contains '--dangerously-skip-permissions') -or ($Arguments -contains '--yolo')
    if (-not $HasAutoApproval) {
        $Arguments += '--auto'
    }
}

if (-not $IsPrimaryRun) {
    & $RealOpenCode @Arguments
    $Code = $LASTEXITCODE
    if ($null -eq $Code) { $Code = 0 }
    exit $Code
}

$Circuit = Get-OpenCircuit
if ($null -ne $Circuit) {
    [Console]::Error.WriteLine("Free usage exceeded: cached primary circuit open until $($Circuit.expiresAt). reason=$($Circuit.reason)")
    exit 173
}

$Id = [Guid]::NewGuid().ToString('N')
$StdoutFile = Join-Path $Root ("primary-$Id.stdout.log")
$StderrFile = Join-Path $Root ("primary-$Id.stderr.log")

$env:FIXUP_REAL_OPENCODE = $RealOpenCode
$ArgsJson = $Arguments | ConvertTo-Json -Compress
$env:FIXUP_REAL_OPENCODE_ARGS = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ArgsJson))
$ChildCommand = '$ErrorActionPreference="Stop"; $json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FIXUP_REAL_OPENCODE_ARGS)); $a=@($json | ConvertFrom-Json); & $env:FIXUP_REAL_OPENCODE @a; $c=$LASTEXITCODE; if ($null -eq $c) { $c=0 }; exit $c'
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

try {
    $Child = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $Encoded) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -PassThru
}
catch {
    [Console]::Error.WriteLine("Provider unavailable: primary OpenCode start failed: $($_.Exception.Message)")
    exit 1
}

$StartedAt = [DateTime]::UtcNow
$StdoutOffset = 0L
$StderrOffset = 0L
$SeenMeaningfulOutput = $false
$DetectedQuota = $false

try {
    while (-not $Child.HasExited) {
        Start-Sleep -Milliseconds 500

        $OutDelta = Get-NewText $StdoutFile $StdoutOffset
        $ErrDelta = Get-NewText $StderrFile $StderrOffset
        $StdoutOffset = [long]$OutDelta.Length
        $StderrOffset = [long]$ErrDelta.Length

        if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text)) {
            [Console]::Out.Write([string]$OutDelta.Text)
        }
        if (-not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) {
            [Console]::Error.Write([string]$ErrDelta.Text)
        }

        $Combined = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine
        if (Test-QuotaExhaustion $Combined) {
            $DetectedQuota = $true
            Set-Circuit 'quota' $QuotaCooldownMinutes
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Free usage exceeded: primary model quota/credit exhausted; circuit cached for $QuotaCooldownMinutes minutes.")
            exit 173
        }

        if (-not [string]::IsNullOrWhiteSpace((Get-MeaningfulText $Combined))) {
            $SeenMeaningfulOutput = $true
        }

        if (-not $SeenMeaningfulOutput -and ([DateTime]::UtcNow - $StartedAt).TotalSeconds -ge $InitialSilenceSeconds) {
            Set-Circuit 'initial_silence' $SilenceCooldownMinutes
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: primary model produced no meaningful output for $InitialSilenceSeconds seconds; short circuit cached for $SilenceCooldownMinutes minutes.")
            exit 1
        }
    }

    try { $Child.WaitForExit() } catch {}

    $OutDelta = Get-NewText $StdoutFile $StdoutOffset
    $ErrDelta = Get-NewText $StderrFile $StderrOffset
    if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text)) { [Console]::Out.Write([string]$OutDelta.Text) }
    if (-not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) { [Console]::Error.Write([string]$ErrDelta.Text) }

    $Tail = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine
    if (Test-QuotaExhaustion $Tail) {
        $DetectedQuota = $true
        Set-Circuit 'quota' $QuotaCooldownMinutes
        [Console]::Error.WriteLine("Free usage exceeded: primary model quota/credit exhausted; circuit cached for $QuotaCooldownMinutes minutes.")
        exit 173
    }

    $ExitCode = 1
    try { $ExitCode = [int]$Child.ExitCode } catch {}
    if ($ExitCode -eq 0 -and -not $DetectedQuota) {
        Clear-Circuit
    }
    exit $ExitCode
}
finally {
    Remove-Item -LiteralPath $StdoutFile, $StderrFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_REAL_OPENCODE -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_REAL_OPENCODE_ARGS -ErrorAction SilentlyContinue
}
