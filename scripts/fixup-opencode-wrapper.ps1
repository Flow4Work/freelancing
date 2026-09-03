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

function Get-MeaningfulText([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $Clean = $Text -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
    $Clean = $Clean -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ''
    return $Clean.Trim()
}

function Get-ProviderName([string]$Model) {
    if ([string]::IsNullOrWhiteSpace($Model)) { return 'unknown' }
    $Slash = $Model.IndexOf('/')
    if ($Slash -le 0) { return 'unknown' }
    return $Model.Substring(0, $Slash).ToLowerInvariant()
}

function Test-OpenCodeFreeQuota([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(freeusagelimiterror|free usage exceeded|free(?:\s+\w+){0,3}\s+(?:limit|quota|usage)(?:\s+\w+){0,4}\s+(?:reached|exceeded|exhausted)|subscribe to go|add credits https://opencode\.ai/(?:go|zen))'
}

function Test-ProviderBillingQuota([string]$Provider, [string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }

    if ($Provider -eq 'mistral') {
        return $Text -match '(?i)(\b402\b(?:\s+\w+){0,4}\s+payment required|payment required|(?:credit|credits|balance)(?:\s+\w+){0,4}\s+(?:expired|exhausted|insufficient|depleted)|(?:monthly|workspace|organization)(?:\s+\w+){0,6}\s+(?:spend|spending|usage)(?:\s+\w+){0,4}\s+(?:limit|quota)(?:\s+\w+){0,4}\s+(?:reached|exceeded|exhausted)|(?:spend|spending|usage)(?:\s+\w+){0,4}\s+(?:limit|quota)(?:\s+\w+){0,4}\s+(?:reached|exceeded|exhausted))'
    }

    if ($Provider -eq 'nvidia') {
        return $Text -match '(?i)(\b402\b(?:\s+\w+){0,4}\s+payment required|payment required|cloud credits? expired|(?:credit|credits|balance)(?:\s+\w+){0,4}\s+(?:expired|exhausted|insufficient|depleted))'
    }

    return $false
}

function Test-ProviderUnavailable([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(upstream request failed(?:\s*:\s*)?.{0,80}endpoint is unavailable|endpoint is unavailable|service unavailable|temporarily unavailable|provider unavailable|resource[_ -]?exhausted|worker local total request limit reached|overloaded|connection (?:reset|refused|lost)|econnreset|econnrefused|etimedout|serialization (?:failure|error)|response.{0,80}missing required.{0,30}\bid\b|stream.{0,80}(?:closed|ended).{0,40}finish_reason|unknown variant.{0,40}finish)'
}

$Root = Join-Path $env:TEMP 'fixup-scout'
if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
}

$PrimaryCircuitFile = Join-Path $Root 'opencode-primary-circuit.json'

function Get-PrimaryCircuit {
    if (-not (Test-Path -LiteralPath $PrimaryCircuitFile)) { return $null }
    try {
        $Raw = Get-Content -LiteralPath $PrimaryCircuitFile -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
        return $Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Set-PrimaryCircuit([string]$Reason, [int]$Minutes) {
    $State = [pscustomobject]@{
        model = $PrimaryModel
        reason = $Reason
        expiresAt = [DateTime]::UtcNow.AddMinutes($Minutes).ToString('o')
    }
    $Json = $State | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($PrimaryCircuitFile, $Json, (New-Object Text.UTF8Encoding($false)))
}

function Clear-PrimaryCircuit {
    Remove-Item -LiteralPath $PrimaryCircuitFile -Force -ErrorAction SilentlyContinue
}

function Get-OpenPrimaryCircuit {
    $State = Get-PrimaryCircuit
    if ($null -eq $State) { return $null }

    if ([string]$State.model -ne $PrimaryModel) {
        Clear-PrimaryCircuit
        return $null
    }

    $Expires = [DateTime]::MinValue
    if (-not [DateTime]::TryParse([string]$State.expiresAt, [ref]$Expires)) {
        Clear-PrimaryCircuit
        return $null
    }

    if ($Expires.ToUniversalTime() -le [DateTime]::UtcNow) {
        Clear-PrimaryCircuit
        return $null
    }

    return $State
}

function Get-ProviderCircuitFile([string]$Provider) {
    $SafeProvider = if ([string]::IsNullOrWhiteSpace($Provider)) { 'unknown' } else { $Provider -replace '[^a-zA-Z0-9_-]', '_' }
    return Join-Path $Root ("opencode-provider-$SafeProvider-quota.json")
}

function Set-ProviderQuotaCircuit([string]$Provider, [int]$Minutes) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return }
    $Path = Get-ProviderCircuitFile $Provider
    $State = [pscustomobject]@{
        provider = $Provider
        reason = 'billing_or_credit'
        expiresAt = [DateTime]::UtcNow.AddMinutes($Minutes).ToString('o')
    }
    $Json = $State | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($Path, $Json, (New-Object Text.UTF8Encoding($false)))
}

function Get-OpenProviderQuotaCircuit([string]$Provider) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return $null }
    $Path = Get-ProviderCircuitFile $Provider
    if (-not (Test-Path -LiteralPath $Path)) { return $null }

    try {
        $Raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
        $State = $Raw | ConvertFrom-Json

        $Expires = [DateTime]::MinValue
        if (-not [DateTime]::TryParse([string]$State.expiresAt, [ref]$Expires)) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
            return $null
        }

        if ($Expires.ToUniversalTime() -le [DateTime]::UtcNow) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
            return $null
        }

        return $State
    }
    catch {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Clear-ProviderQuotaCircuit([string]$Provider) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return }
    Remove-Item -LiteralPath (Get-ProviderCircuitFile $Provider) -Force -ErrorAction SilentlyContinue
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
if (-not $IsRun) {
    & $RealOpenCode @Arguments
    $Code = $LASTEXITCODE
    if ($null -eq $Code) { $Code = 0 }
    exit $Code
}

$Provider = Get-ProviderName $Model
$IsPrimaryRun = $Model -eq $PrimaryModel

if (-not $IsPrimaryRun -and -not ($Arguments -contains '--dangerously-skip-permissions')) {
    $Arguments += '--dangerously-skip-permissions'
}

if ($IsPrimaryRun) {
    $Circuit = Get-OpenPrimaryCircuit
    if ($null -ne $Circuit) {
        [Console]::Error.WriteLine("Free usage exceeded: cached primary circuit open until $($Circuit.expiresAt). reason=$($Circuit.reason)")
        exit 173
    }
}
else {
    $ProviderCircuit = Get-OpenProviderQuotaCircuit $Provider
    if ($null -ne $ProviderCircuit) {
        [Console]::Error.WriteLine("Quota exceeded: cached $Provider billing/credit circuit open until $($ProviderCircuit.expiresAt).")
        exit 174
    }
}

$Id = [Guid]::NewGuid().ToString('N')
$StdoutFile = Join-Path $Root ("run-$Provider-$Id.stdout.log")
$StderrFile = Join-Path $Root ("run-$Provider-$Id.stderr.log")

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
    [Console]::Error.WriteLine("Provider unavailable: OpenCode start failed for $Model: $($_.Exception.Message)")
    exit 1
}

$StartedAt = [DateTime]::UtcNow
$StdoutOffset = 0L
$StderrOffset = 0L
$SeenMeaningfulOutput = $false

try {
    while (-not $Child.HasExited) {
        Start-Sleep -Milliseconds 500

        $OutDelta = Get-NewText $StdoutFile $StdoutOffset
        $ErrDelta = Get-NewText $StderrFile $StderrOffset
        $StdoutOffset = [long]$OutDelta.Length
        $StderrOffset = [long]$ErrDelta.Length

        $Combined = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine

        if ($IsPrimaryRun -and (Test-OpenCodeFreeQuota $Combined)) {
            Set-PrimaryCircuit 'quota' $QuotaCooldownMinutes
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Free usage exceeded: primary model quota exhausted; circuit cached for $QuotaCooldownMinutes minutes.")
            exit 173
        }

        if (Test-ProviderBillingQuota $Provider $Combined) {
            Set-ProviderQuotaCircuit $Provider $QuotaCooldownMinutes
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Quota exceeded: $Provider billing/credits unavailable; provider circuit cached for $QuotaCooldownMinutes minutes.")
            exit 174
        }

        if (Test-ProviderUnavailable $Combined) {
            if ($IsPrimaryRun) {
                Set-PrimaryCircuit 'provider_unavailable' $SilenceCooldownMinutes
            }
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: $Model upstream/capacity/protocol failure.")
            exit 175
        }

        if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text)) {
            [Console]::Out.Write([string]$OutDelta.Text)
        }
        if (-not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) {
            [Console]::Error.Write([string]$ErrDelta.Text)
        }

        if (-not [string]::IsNullOrWhiteSpace((Get-MeaningfulText $Combined))) {
            $SeenMeaningfulOutput = $true
        }

        if ($IsPrimaryRun -and -not $SeenMeaningfulOutput -and ([DateTime]::UtcNow - $StartedAt).TotalSeconds -ge $InitialSilenceSeconds) {
            Set-PrimaryCircuit 'initial_silence' $SilenceCooldownMinutes
            Stop-ChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: primary model produced no meaningful output for $InitialSilenceSeconds seconds; short circuit cached for $SilenceCooldownMinutes minutes.")
            exit 1
        }
    }

    try { $Child.WaitForExit() } catch {}

    $OutDelta = Get-NewText $StdoutFile $StdoutOffset
    $ErrDelta = Get-NewText $StderrFile $StderrOffset
    $Tail = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine

    if ($IsPrimaryRun -and (Test-OpenCodeFreeQuota $Tail)) {
        Set-PrimaryCircuit 'quota' $QuotaCooldownMinutes
        [Console]::Error.WriteLine("Free usage exceeded: primary model quota exhausted; circuit cached for $QuotaCooldownMinutes minutes.")
        exit 173
    }

    if (Test-ProviderBillingQuota $Provider $Tail) {
        Set-ProviderQuotaCircuit $Provider $QuotaCooldownMinutes
        [Console]::Error.WriteLine("Quota exceeded: $Provider billing/credits unavailable; provider circuit cached for $QuotaCooldownMinutes minutes.")
        exit 174
    }

    if (Test-ProviderUnavailable $Tail) {
        if ($IsPrimaryRun) {
            Set-PrimaryCircuit 'provider_unavailable' $SilenceCooldownMinutes
        }
        [Console]::Error.WriteLine("Provider unavailable: $Model upstream/capacity/protocol failure.")
        exit 175
    }

    if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text)) {
        [Console]::Out.Write([string]$OutDelta.Text)
    }
    if (-not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) {
        [Console]::Error.Write([string]$ErrDelta.Text)
    }

    $ExitCode = 1
    try { $ExitCode = [int]$Child.ExitCode } catch {}

    if ($ExitCode -eq 0) {
        if ($IsPrimaryRun) {
            Clear-PrimaryCircuit
        }
        else {
            Clear-ProviderQuotaCircuit $Provider
        }
    }

    exit $ExitCode
}
finally {
    Remove-Item -LiteralPath $StdoutFile, $StderrFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_REAL_OPENCODE -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_REAL_OPENCODE_ARGS -ErrorAction SilentlyContinue
}
