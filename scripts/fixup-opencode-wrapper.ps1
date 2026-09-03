$ErrorActionPreference = 'Stop'

$PrimaryModel = if ([string]::IsNullOrWhiteSpace($env:FIXUP_OPENCODE_PRIMARY_MODEL)) {
    'opencode/muse-spark-1.2-contributor-free'
} else {
    $env:FIXUP_OPENCODE_PRIMARY_MODEL.Trim()
}

$CoreScript = Join-Path $PSScriptRoot 'fixup-opencode-core.ps1'
if (-not (Test-Path -LiteralPath $CoreScript)) {
    throw "FixUp OpenCode core wrapper not found: $CoreScript"
}

$QuotaCircuitMinutes = 60
if ($env:FIXUP_OPENCODE_QUOTA_COOLDOWN_MINUTES -match '^\d+$') {
    $QuotaCircuitMinutes = [Math]::Max(5, [Math]::Min(1440, [int]$env:FIXUP_OPENCODE_QUOTA_COOLDOWN_MINUTES))
}

function Stop-OwnChildTree([int]$TargetPid) {
    if ($TargetPid -le 0) { return }
    try {
        & taskkill.exe /PID $TargetPid /T /F 2>$null | Out-Null
    } catch {
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
        } finally {
            $Stream.Dispose()
        }
    } catch {
        return [pscustomobject]@{ Text = ''; Length = $Offset }
    }
}

function Get-ProviderName([string]$Model) {
    if ([string]::IsNullOrWhiteSpace($Model)) { return 'unknown' }
    $Slash = $Model.IndexOf('/')
    if ($Slash -le 0) { return 'unknown' }
    return $Model.Substring(0, $Slash).ToLowerInvariant()
}

function Test-OpenCodeFreeQuota([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(FreeUsageLimitError|Free usage exceeded|Free limit reached|subscribe to Go|add credits https://opencode\.ai/(?:go|zen))'
}

function Test-ProviderBillingQuota([string]$Provider, [string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }

    if ($Provider -eq 'mistral') {
        return $Text -match '(?i)(\b402\b.{0,80}Payment Required|Payment Required|(?:credit|credits|balance).{0,80}(?:expired|exhausted|insufficient|depleted)|(?:monthly|workspace|organization).{0,100}(?:spend|spending|usage).{0,60}(?:limit|quota).{0,60}(?:reached|exceeded|exhausted))'
    }

    if ($Provider -eq 'nvidia') {
        return $Text -match '(?i)(\b402\b.{0,100}(?:Cloud credits expired|Payment Required)|Cloud credits expired|(?:credit|credits|balance).{0,80}(?:expired|exhausted|insufficient|depleted))'
    }

    return $false
}

function Test-ProviderUnavailable([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(\b50[0234]\b|service unavailable|temporarily unavailable|provider unavailable|endpoint is unavailable|upstream request failed|resource[_ -]?exhausted|worker local total request limit reached|overloaded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|connection (?:reset|refused|lost)|serialization (?:failure|error)|response.{0,100}missing required.{0,40}\bid\b|stream.{0,100}(?:closed|ended).{0,50}finish_reason|unknown variant.{0,50}finish)'
}

$Root = Join-Path $env:TEMP 'fixup-scout'
if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
}

function Get-ProviderCircuitFile([string]$Provider) {
    $Safe = if ([string]::IsNullOrWhiteSpace($Provider)) { 'unknown' } else { $Provider -replace '[^a-zA-Z0-9_-]', '_' }
    return Join-Path $Root ("opencode-provider-$Safe-quota.json")
}

function Get-ProviderCircuit([string]$Provider) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return $null }

    $Path = Get-ProviderCircuitFile $Provider
    if (-not (Test-Path -LiteralPath $Path)) { return $null }

    try {
        $State = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop) | ConvertFrom-Json
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
    } catch {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Set-ProviderCircuit([string]$Provider) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return }

    $Path = Get-ProviderCircuitFile $Provider
    $State = [pscustomobject]@{
        provider = $Provider
        reason = 'billing_or_credit'
        expiresAt = [DateTime]::UtcNow.AddMinutes($QuotaCircuitMinutes).ToString('o')
    }
    [IO.File]::WriteAllText(
        $Path,
        ($State | ConvertTo-Json -Compress),
        (New-Object Text.UTF8Encoding($false))
    )
}

function Clear-ProviderCircuit([string]$Provider) {
    if ($Provider -eq 'unknown' -or $Provider -eq 'opencode') { return }
    Remove-Item -LiteralPath (Get-ProviderCircuitFile $Provider) -Force -ErrorAction SilentlyContinue
}

$Arguments = @($args)
$Model = $null
for ($i = 0; $i -lt $Arguments.Count - 1; $i++) {
    if ([string]$Arguments[$i] -eq '--model') {
        $Model = [string]$Arguments[$i + 1]
        break
    }
}

$IsRun = $Arguments.Count -gt 0 -and [string]$Arguments[0] -eq 'run'
$Provider = Get-ProviderName $Model
$IsPrimary = $IsRun -and $Model -eq $PrimaryModel

$env:FIXUP_OPENCODE_PRIMARY_MODEL = $PrimaryModel

if (-not $IsRun) {
    & $CoreScript @Arguments
    $Code = $LASTEXITCODE
    if ($null -eq $Code) { $Code = 0 }
    exit $Code
}

if (-not $IsPrimary) {
    $Circuit = Get-ProviderCircuit $Provider
    if ($null -ne $Circuit) {
        [Console]::Error.WriteLine("Quota exceeded: cached provider credits exhausted for $Provider; circuit open until $($Circuit.expiresAt).")
        exit 174
    }
}

$Id = [Guid]::NewGuid().ToString('N')
$StdoutFile = Join-Path $Root ("gate-$Provider-$Id.stdout.log")
$StderrFile = Join-Path $Root ("gate-$Provider-$Id.stderr.log")

$env:FIXUP_GATE_CORE = $CoreScript
$ArgsJson = $Arguments | ConvertTo-Json -Compress
$env:FIXUP_GATE_ARGS = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ArgsJson))
$ChildCommand = '$ErrorActionPreference="Stop"; $json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FIXUP_GATE_ARGS)); $a=@($json | ConvertFrom-Json); & $env:FIXUP_GATE_CORE @a; $c=$LASTEXITCODE; if ($null -eq $c) { $c=0 }; exit $c'
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

try {
    $Child = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $Encoded) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -PassThru
} catch {
    [Console]::Error.WriteLine("Provider unavailable: failed to start OpenCode gate for ${Model}: $($_.Exception.Message)")
    exit 175
}

$StdoutOffset = 0L
$StderrOffset = 0L

try {
    while (-not $Child.HasExited) {
        Start-Sleep -Milliseconds 250

        $OutDelta = Get-NewText $StdoutFile $StdoutOffset
        $ErrDelta = Get-NewText $StderrFile $StderrOffset
        $StdoutOffset = [long]$OutDelta.Length
        $StderrOffset = [long]$ErrDelta.Length

        $Combined = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine

        if ($IsPrimary -and (Test-OpenCodeFreeQuota $Combined)) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine('Free usage exceeded: primary model quota exhausted.')
            exit 173
        }

        if (Test-ProviderBillingQuota $Provider $Combined) {
            Set-ProviderCircuit $Provider
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Quota exceeded: provider credits exhausted for $Provider.")
            exit 174
        }

        if (Test-ProviderUnavailable $Combined) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: upstream/capacity/protocol failure for $Model.")
            exit 175
        }

        if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text)) {
            [Console]::Out.Write([string]$OutDelta.Text)
        }
        if (-not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) {
            [Console]::Error.Write([string]$ErrDelta.Text)
        }
    }

    try { $Child.WaitForExit() } catch {}

    $OutDelta = Get-NewText $StdoutFile $StdoutOffset
    $ErrDelta = Get-NewText $StderrFile $StderrOffset
    $Tail = @([string]$OutDelta.Text, [string]$ErrDelta.Text) -join [Environment]::NewLine

    if ($IsPrimary -and (Test-OpenCodeFreeQuota $Tail)) {
        [Console]::Error.WriteLine('Free usage exceeded: primary model quota exhausted.')
        exit 173
    }

    if (Test-ProviderBillingQuota $Provider $Tail) {
        Set-ProviderCircuit $Provider
        [Console]::Error.WriteLine("Quota exceeded: provider credits exhausted for $Provider.")
        exit 174
    }

    if (Test-ProviderUnavailable $Tail) {
        [Console]::Error.WriteLine("Provider unavailable: upstream/capacity/protocol failure for $Model.")
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

    if ($ExitCode -eq 0 -and -not $IsPrimary) {
        Clear-ProviderCircuit $Provider
    }

    exit $ExitCode
} finally {
    Remove-Item -LiteralPath $StdoutFile, $StderrFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_GATE_CORE -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_GATE_ARGS -ErrorAction SilentlyContinue
}
