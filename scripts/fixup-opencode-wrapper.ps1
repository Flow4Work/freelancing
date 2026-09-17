$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$PrimaryModel = if ([string]::IsNullOrWhiteSpace($env:FIXUP_OPENCODE_PRIMARY_MODEL)) {
    'opencode/muse-spark-1.2-contributor-free'
} else {
    $env:FIXUP_OPENCODE_PRIMARY_MODEL.Trim()
}

$CoreScript = Join-Path $PSScriptRoot 'fixup-opencode-core.ps1'
if (-not (Test-Path -LiteralPath $CoreScript)) {
    throw "FixUp OpenCode core wrapper not found: $CoreScript"
}

$PlaywrightProfile = if ([string]::IsNullOrWhiteSpace($env:FIXUP_OPENCODE_CHROME_PROFILE)) { 'Profile 3' } else { $env:FIXUP_OPENCODE_CHROME_PROFILE.Trim() }
$PlaywrightUserDataDir = if ([string]::IsNullOrWhiteSpace($env:PWTEST_EXTENSION_USER_DATA_DIR)) { Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data' } else { $env:PWTEST_EXTENSION_USER_DATA_DIR.Trim() }
$PlaywrightLocalStatePath = Join-Path $PlaywrightUserDataDir 'Local State'
$PlaywrightExtensionId = 'mmlmfjhmonkocbjadbfplnigmagldckm'
$PlaywrightProfilePreload = Join-Path $PSScriptRoot 'fixup-playwright-profile3.cjs'

function Enter-FixUpPlaywrightProfile {
    if (-not (Test-Path -LiteralPath $PlaywrightLocalStatePath)) { throw "Chrome Local State를 찾을 수 없습니다: $PlaywrightLocalStatePath" }
    $ProfilePath = Join-Path $PlaywrightUserDataDir $PlaywrightProfile
    if (-not (Test-Path -LiteralPath $ProfilePath)) { throw "FixUp Chrome profile을 찾을 수 없습니다: $ProfilePath" }
    $ExtensionPath = Join-Path $ProfilePath ("Extensions\" + $PlaywrightExtensionId)
    if (-not (Test-Path -LiteralPath $ExtensionPath)) { throw "Profile 3에 Playwright MCP 확장이 없습니다: $ExtensionPath" }
    if (-not (Test-Path -LiteralPath $PlaywrightProfilePreload)) { throw "FixUp Playwright Profile 3 preload를 찾을 수 없습니다: $PlaywrightProfilePreload" }

    $env:FIXUP_PLAYWRIGHT_MCP_PROFILE = $PlaywrightProfile
    $env:FIXUP_PLAYWRIGHT_MCP_USER_DATA_DIR = $PlaywrightUserDataDir
    $RequireArg = "--require=$PlaywrightProfilePreload"
    if ([string]::IsNullOrWhiteSpace($env:NODE_OPTIONS)) {
        $env:NODE_OPTIONS = $RequireArg
    } elseif ($env:NODE_OPTIONS -notmatch [regex]::Escape($PlaywrightProfilePreload)) {
        $env:NODE_OPTIONS = "$($env:NODE_OPTIONS) $RequireArg"
    }

    $ProbeScript = "const fs=require('node:fs'),p=require('node:path');const f=p.join(process.env.FIXUP_PLAYWRIGHT_MCP_USER_DATA_DIR,'Local State');fs.promises.readFile(f,'utf8').then(x=>console.log(JSON.parse(x).profile.last_used)).catch(e=>{console.error(e);process.exit(1)})"
    $Probe = @(& node.exe -e $ProbeScript 2>&1)
    if ($LASTEXITCODE -ne 0 -or [string]$Probe[-1] -ne $PlaywrightProfile) {
        throw "FixUp Playwright MCP Profile 3 preload verification failed."
    }
}

function Exit-FixUpPlaywrightProfile { }

function Write-FixUpLocalFailure([string]$Detail) {
    $Clean = ($Detail -replace '[\r\n\t ]+', ' ').Trim()
    [Console]::Error.WriteLine("Local execution failure: $Clean")
    if ($env:FIXUP_OPENCODE_ERROR_FILE) {
        [IO.File]::WriteAllText($env:FIXUP_OPENCODE_ERROR_FILE, $Clean, (New-Object Text.UTF8Encoding($false)))
    }
}

$SemanticStallSeconds = 75
$FinalSafetySeconds = 1800
$HardInactivitySeconds = 180
if ($env:FIXUP_OPENCODE_STALL_SECONDS -match '^\d+$') {
    $SemanticStallSeconds = [Math]::Max(30, [Math]::Min(600, [int]$env:FIXUP_OPENCODE_STALL_SECONDS))
}
if ($env:FIXUP_OPENCODE_FINAL_SAFETY_SECONDS -match '^\d+$') {
    $FinalSafetySeconds = [Math]::Max(600, [Math]::Min(7200, [int]$env:FIXUP_OPENCODE_FINAL_SAFETY_SECONDS))
}

if ($env:FIXUP_OPENCODE_HARD_INACTIVITY_SECONDS -match '^\d+$') {
    $HardInactivitySeconds = [Math]::Max(60, [Math]::Min(900, [int]$env:FIXUP_OPENCODE_HARD_INACTIVITY_SECONDS))
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

function Test-DmRecoverableClickFailure([string]$Tool, [string]$Detail) {
    if ($env:FIXUP_SCOUT_AGENT -notin @('fixup-dm','fixup-dm-sync')) { return $false }
    if ($Tool -ne 'playwright_b_browser_click') { return $false }
    $Actionability = $Detail -match '(?is)TimeoutError: browserBackend\.callTool: Timeout 5000ms exceeded.*locator resolved to.*attempting click action.*waiting for element to be visible, enabled and stable'
    if ($env:FIXUP_SCOUT_AGENT -eq 'fixup-dm-sync') { return $Actionability }
    return $Actionability -or $Detail -match '(?is)(Ref\s+(?:f\d+)?e\d+\s+not found in the current page snapshot|FIXUP_REF_GUARD raw snapshot ref .* is not proven|element.*(?:detached|not attached))'
}

function Get-OpenCodeErrorSignal([string]$StdoutText, [string]$StderrText) {
    $Parts = New-Object 'System.Collections.Generic.List[string]'
    $BrowserToolCompleted = $false
    foreach ($Line in ($StderrText -split "`r?`n")) {
        if ($Line -match '(?i)(level=ERROR|^(?:Free usage exceeded|Quota exceeded|Provider unavailable|OpenRouter free daily|Local execution failure))') { [void]$Parts.Add($Line) }
    }
    foreach ($Line in ($StdoutText -split "`r?`n")) {
        try { $Event = $Line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if ($Event.type -eq 'error') { [void]$Parts.Add(($Event.error | ConvertTo-Json -Depth 30 -Compress)) }
        if ($Event.type -eq 'tool_use') {
            $State = $Event.part.state
            $Tool = [string]$Event.part.tool
            if ($Tool -like 'playwright_b_*' -and $State.status -eq 'completed') { $BrowserToolCompleted = $true }
            if ($State.status -eq 'error' -or [string]$State.output -match '^### Error') {
                $Detail = [string]$State.error + ' ' + [string]$State.output
                if (Test-DmRecoverableClickFailure $Tool $Detail) { continue }
                $SharedBrowserFailure = $Detail -match '(?i)(spawn|connection|\bNot connected\b|Extension not connected|MCP\s+(?:connection|server|transport|unavailable|failed)|browser.*launch)'
                $BareMcpRequestTimeout = $Detail -match '(?i)MCP error\s+-32001:\s*Request timed out'
                $Kind = if ($Detail -match '(?i)(FIXUP_PERMISSION_DENIED|prevents you from using|permission.*den|rejected permission)') { 'permission_denied' }
                    elseif ($Tool -like 'fixup_result_*') { 'post_failure' }
                    elseif ($Tool -like 'playwright_b_*' -and $SharedBrowserFailure) { 'browser_unavailable' }
                    elseif ($Tool -like 'playwright_b_*' -and $BareMcpRequestTimeout -and -not $BrowserToolCompleted) { 'browser_unavailable' }
                    else { 'tool_execution' }
                $Preflight = if ($BrowserToolCompleted) { 'passed' } else { 'not_passed' }
                [void]$Parts.Add("FIXUP_LOCAL_$Kind tool=$Tool browser_preflight=$Preflight $Detail")
            }
        }
    }
    return ($Parts -join [Environment]::NewLine)
}

function Test-LocalBrowserRuntimeFailure([string]$Text) {
    return $Text -match 'FIXUP_LOCAL_browser_unavailable'
}

function Get-LocalFailureCode([string]$Text) {
    if ($Text -match 'FIXUP_LOCAL_permission_denied') { return 177 }
    if ($Text -match 'FIXUP_LOCAL_post_failure') { return 178 }
    if ($Text -match 'FIXUP_LOCAL_browser_unavailable') { return 176 }
    if ($Text -match 'FIXUP_LOCAL_tool_execution') { return 179 }
    if ($Text -match '(?m)^Local execution failure:') { return 180 }
    return 0
}

function Test-OpenCodeFreeQuota([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(FreeUsageLimitError|free_tier_limit|Free usage exceeded|Free limit reached|subscribe to Go|add credits https://opencode\.ai/(?:go|zen)|Rate limit exceeded|\b429\b)'
}

function Test-ProviderUsageQuota([string]$Provider, [string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    if ($Provider -eq 'openrouter') {
        return $Text -match '(?i)free-models-per-day(?:-high-balance)?'
    }
    if ($Provider -ne 'zai-coding-plan') { return $false }
    return $Text -match '(?is)\bUsage limit reached\b.{0,240}\b(?:limit\s+(?:will\s+)?reset|resets?\s+at)\b'
}

function Test-ProviderBillingQuota([string]$Provider, [string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }

    if ($Provider -eq 'mistral') {
        return $Text -match '(?i)(\b402\b.{0,100}Payment Required|Payment Required|(?:credit|credits|balance).{0,100}(?:expired|exhausted|insufficient|depleted)|(?:monthly|workspace|organization|spend|spending|usage).{0,120}(?:limit|quota|budget).{0,80}(?:reached|exceeded|exhausted|blocked)|(?:limit|quota|budget).{0,80}(?:reached|exceeded|exhausted).{0,100}(?:monthly|workspace|organization|spend|spending|usage))'
    }

    if ($Provider -eq 'nvidia') {
        return $Text -match '(?i)(\b402\b.{0,120}(?:Cloud credits expired|Payment Required)|Cloud credits expired|(?:credit|credits|balance).{0,100}(?:expired|exhausted|insufficient|depleted))'
    }

    if ($Provider -eq 'vercel') {
        return $Text -match '(?i)(\b402\b.{0,120}Payment Required|requires a valid credit card|add a card.{0,80}(?:free credits|credits)|Free tier users do not have access to this model|Upgrade to paid credits|(?:credit|credits|balance).{0,100}(?:expired|exhausted|insufficient|depleted|locked))'
    }

    if ($Provider -eq 'venice') {
        return $Text -match '(?i)(\b402\b.{0,120}Payment Required|Payment Required|Insufficient USD or Diem balance|(?:credit|credits|balance).{0,100}(?:expired|exhausted|insufficient|depleted))'
    }

    return $false
}

function Test-ProviderUnavailable([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(\b50[0234]\b|service unavailable|provider unavailable|upstream request failed|overloaded)'
}

function Test-ProviderRateLimit([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(Rate limit exceeded|\b429\b|rate[_ -]?limited|x-ratelimit-(?:limit|remaining)-req-minute)'
}

function Test-OpenCodePhaseProgress([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?i)(message=bootstrapping|message=loading path=|message=init(?:\s|$)|message=init count=|message="booting location services"|message=stream providerID=|message="llm runtime selected")'
}

function Test-SemanticProgress([string]$StdoutText) {
    if ([string]::IsNullOrWhiteSpace($StdoutText)) { return $false }
    return $StdoutText -match '(?i)"type"\s*:\s*"(?:step_start|step_finish|tool_use|text)"'
}

function Write-FilteredOpenCodeOutput([string]$StdoutText, [string]$StderrText) {
    if ($StdoutText) { [Console]::Out.Write($StdoutText) }
    if ($StderrText) { [Console]::Error.Write($StderrText) }
}

$Root = Join-Path $env:TEMP 'fixup-scout'
if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
}
$OpenRouterDailyCircuitFile = Join-Path $Root 'opencode-openrouter-free-daily.json'

function Get-OpenRouterDailyCircuit {
    if (-not (Test-Path -LiteralPath $OpenRouterDailyCircuitFile)) { return $null }
    try {
        $State = (Get-Content -LiteralPath $OpenRouterDailyCircuitFile -Raw -ErrorAction Stop) | ConvertFrom-Json
        $TodayUtc = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
        if ([string]$State.utcDate -ne $TodayUtc) {
            Remove-Item -LiteralPath $OpenRouterDailyCircuitFile -Force -ErrorAction SilentlyContinue
            return $null
        }
        return $State
    } catch {
        Remove-Item -LiteralPath $OpenRouterDailyCircuitFile -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Set-OpenRouterDailyCircuit([string]$Limiter) {
    $State = [pscustomobject]@{
        provider = 'openrouter'
        scope = 'free-models-per-day'
        limiter = $Limiter
        utcDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
        detectedAt = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText($OpenRouterDailyCircuitFile, ($State | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
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
if ($IsRun -and $env:FIXUP_OPENCODE_ERROR_FILE) { Remove-Item -LiteralPath $env:FIXUP_OPENCODE_ERROR_FILE -Force -ErrorAction SilentlyContinue }
$IsPrimary = $IsRun -and $Model -eq $PrimaryModel
$IsOpenRouterFree = $IsRun -and $Provider -eq 'openrouter' -and $Model -match ':free$'

if ($IsOpenRouterFree -and $null -ne (Get-OpenRouterDailyCircuit)) {
    [Console]::Error.WriteLine('OpenRouter free daily request limit exhausted for the current UTC day; skipping request until the daily window resets.')
    exit 174
}

$env:FIXUP_OPENCODE_PRIMARY_MODEL = $PrimaryModel
if ($IsRun) {
    try {
        $InlineConfig = if ([string]::IsNullOrWhiteSpace($env:OPENCODE_CONFIG_CONTENT)) { [pscustomobject]@{} } else { $env:OPENCODE_CONFIG_CONTENT | ConvertFrom-Json -ErrorAction Stop }
        $InlineAgents = if ($null -eq $InlineConfig.agent) { [pscustomobject]@{} } else { $InlineConfig.agent }
        $TitleAgent = if ($null -eq $InlineAgents.title) { [pscustomobject]@{} } else { $InlineAgents.title }
        $TitleAgent | Add-Member -NotePropertyName 'disable' -NotePropertyValue $true -Force
        $InlineAgents | Add-Member -NotePropertyName 'title' -NotePropertyValue $TitleAgent -Force
        $InlineConfig | Add-Member -NotePropertyName 'agent' -NotePropertyValue $InlineAgents -Force
        $env:OPENCODE_CONFIG_CONTENT = $InlineConfig | ConvertTo-Json -Depth 50 -Compress
    } catch {
        throw "FixUp OpenCode inline config를 적용하지 못했습니다: $($_.Exception.Message)"
    }
}

if (-not $IsRun) {
    & $CoreScript @Arguments
    $Code = $LASTEXITCODE
    if ($null -eq $Code) { $Code = 0 }
    exit $Code
}

$HasAutoApproval = ($Arguments -contains '--auto') -or ($Arguments -contains '--yolo') -or ($Arguments -contains '--dangerously-skip-permissions')
if (-not $HasAutoApproval) {
    $Arguments += '--auto'
}

$HasFormat = $false
for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $ArgumentText = [string]$Arguments[$i]
    if ($ArgumentText -eq '--format' -or $ArgumentText -like '--format=*') {
        $HasFormat = $true
        break
    }
}
if (-not $HasFormat) {
    $Arguments += @('--format', 'json')
}

$HasPrintLogs = $Arguments -contains '--print-logs'
if (-not $HasPrintLogs) { $Arguments += '--print-logs' }
$HasLogLevel = $Arguments -contains '--log-level'
if (-not $HasLogLevel) { $Arguments += @('--log-level', 'INFO') }

$Id = [Guid]::NewGuid().ToString('N')
$StdoutFile = Join-Path $Root ("gate-$Provider-$Id.stdout.log")
$StderrFile = Join-Path $Root ("gate-$Provider-$Id.stderr.log")
$StdinFile = Join-Path $Root ("gate-$Provider-$Id.stdin")
[IO.File]::WriteAllBytes($StdinFile, [byte[]]@())

try {
    Enter-FixUpPlaywrightProfile
} catch {
    Exit-FixUpPlaywrightProfile
    [Console]::Error.WriteLine("Local browser runtime unavailable: $($_.Exception.Message)")
    exit 176
}

$env:FIXUP_GATE_CORE = $CoreScript
$ArgsJson = ConvertTo-Json -InputObject @($Arguments) -Compress
$env:FIXUP_GATE_ARGS = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ArgsJson))
$ChildCommand = '$ErrorActionPreference="Stop"; $json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FIXUP_GATE_ARGS)); $parsed=ConvertFrom-Json -InputObject $json; $a=@($parsed); & $env:FIXUP_GATE_CORE @a; $c=$LASTEXITCODE; if ($null -eq $c) { $c=0 }; exit $c'
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand))

try {
    $Child = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $Encoded) `
        -WindowStyle Hidden `
        -RedirectStandardInput $StdinFile `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -PassThru
} catch {
    [Console]::Error.WriteLine("Local execution failure: failed to start OpenCode gate for ${Model}. $($_.Exception.Message)")
    exit 180
}

$null = $Child.Handle # Retain the OS handle before HasExited polling on Windows PowerShell.
$StdoutOffset = 0L
$StderrOffset = 0L
$LastSemanticAt = [DateTime]::UtcNow
$AttemptStartedAt = [DateTime]::UtcNow
$LastAnyOutputAt = [DateTime]::UtcNow
$ProviderRequestInFlight = $false

try {
    while (-not $Child.HasExited) {
        Start-Sleep -Milliseconds 250

        $OutDelta = Get-NewText $StdoutFile $StdoutOffset
        $ErrDelta = Get-NewText $StderrFile $StderrOffset
        $StdoutOffset = [long]$OutDelta.Length
        $StderrOffset = [long]$ErrDelta.Length

        Write-FilteredOpenCodeOutput ([string]$OutDelta.Text) ([string]$ErrDelta.Text)

        $SignalText = Get-OpenCodeErrorSignal ([string](Get-NewText $StdoutFile 0).Text) ([string](Get-NewText $StderrFile 0).Text)
        $LocalCode = Get-LocalFailureCode $SignalText
        if ($LocalCode -ne 0) {
            Stop-OwnChildTree $Child.Id
            Write-FixUpLocalFailure $SignalText
            exit $LocalCode
        }

        if (Test-LocalBrowserRuntimeFailure $SignalText) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Local browser runtime unavailable: playwright_b/Profile 3 MCP failure for $Model.")
            exit 176
        }

        if (-not [string]::IsNullOrEmpty([string]$OutDelta.Text) -or -not [string]::IsNullOrEmpty([string]$ErrDelta.Text)) {
            $LastAnyOutputAt = [DateTime]::UtcNow
        }

        if (Test-OpenCodePhaseProgress ([string]$ErrDelta.Text)) { $LastSemanticAt = [DateTime]::UtcNow }
        if ([string]$ErrDelta.Text -match '(?i)(message=stream providerID=|message="llm runtime selected")') { $ProviderRequestInFlight = $true }

        if ($IsPrimary -and (Test-OpenCodeFreeQuota $SignalText)) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine('Free usage exceeded: primary model free quota exhausted.')
            exit 173
        }

        if (Test-ProviderUsageQuota $Provider $SignalText) {
            if ($IsOpenRouterFree) { Set-OpenRouterDailyCircuit 'free-models-per-day' }
            Stop-OwnChildTree $Child.Id
            if ($IsOpenRouterFree) {
                [Console]::Error.WriteLine('OpenRouter free daily request limit exhausted; cached for the current UTC day.')
            } else {
                [Console]::Error.WriteLine("Quota exceeded: provider usage window exhausted for $Provider.")
            }
            exit 174
        }

        if (Test-ProviderBillingQuota $Provider $SignalText) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Quota exceeded: provider credits exhausted for $Provider.")
            exit 174
        }

        if (-not $IsPrimary -and (Test-ProviderRateLimit $SignalText)) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: rate limit for $Model.")
            exit 175
        }

        if (Test-ProviderUnavailable $SignalText) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: upstream/capacity/protocol failure for $Model.")
            exit 175
        }

        if (Test-SemanticProgress ([string]$OutDelta.Text)) {
            $LastSemanticAt = [DateTime]::UtcNow
            $ProviderRequestInFlight = $false
        }

        if (-not $ProviderRequestInFlight -and ([DateTime]::UtcNow - $LastSemanticAt).TotalSeconds -ge $SemanticStallSeconds) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Provider unavailable: no semantic tool/text progress for $SemanticStallSeconds seconds on $Model; possible internal retry, quota wait, or provider hang.")
            exit 175
        }

        if (([DateTime]::UtcNow - $LastAnyOutputAt).TotalSeconds -ge $HardInactivitySeconds) {
            Stop-OwnChildTree $Child.Id
            if ($ProviderRequestInFlight) {
                [Console]::Error.WriteLine("Provider unavailable: no stdout/stderr activity for $HardInactivitySeconds seconds while a provider request was in flight for $Model.")
                exit 175
            }
            [Console]::Error.WriteLine("Local execution failure: no stdout/stderr activity for $HardInactivitySeconds seconds on $Model.")
            exit 180
        }

        if (([DateTime]::UtcNow - $AttemptStartedAt).TotalSeconds -ge $FinalSafetySeconds) {
            Stop-OwnChildTree $Child.Id
            [Console]::Error.WriteLine("Local execution failure: final safety limit $FinalSafetySeconds seconds exceeded for $Model despite semantic progress monitoring.")
            exit 180
        }
    }

    try { $Child.WaitForExit() } catch {}

    $OutDelta = Get-NewText $StdoutFile $StdoutOffset
    $ErrDelta = Get-NewText $StderrFile $StderrOffset
    Write-FilteredOpenCodeOutput ([string]$OutDelta.Text) ([string]$ErrDelta.Text)
    $SignalText = Get-OpenCodeErrorSignal ([string](Get-NewText $StdoutFile 0).Text) ([string](Get-NewText $StderrFile 0).Text)
        $LocalCode = Get-LocalFailureCode $SignalText
        if ($LocalCode -ne 0) {
            Stop-OwnChildTree $Child.Id
            Write-FixUpLocalFailure $SignalText
            exit $LocalCode
        }

    if (Test-LocalBrowserRuntimeFailure $SignalText) {
        [Console]::Error.WriteLine("Local browser runtime unavailable: playwright_b/Profile 3 MCP failure for $Model.")
        exit 176
    }

    if ($IsPrimary -and (Test-OpenCodeFreeQuota $SignalText)) {
        [Console]::Error.WriteLine('Free usage exceeded: primary model free quota exhausted.')
        exit 173
    }

    if (Test-ProviderUsageQuota $Provider $SignalText) {
        if ($IsOpenRouterFree) { Set-OpenRouterDailyCircuit 'free-models-per-day' }
        if ($IsOpenRouterFree) {
            [Console]::Error.WriteLine('OpenRouter free daily request limit exhausted; cached for the current UTC day.')
        } else {
            [Console]::Error.WriteLine("Quota exceeded: provider usage window exhausted for $Provider.")
        }
        exit 174
    }

    if (Test-ProviderBillingQuota $Provider $SignalText) {
        [Console]::Error.WriteLine("Quota exceeded: provider credits exhausted for $Provider.")
        exit 174
    }

    if (-not $IsPrimary -and (Test-ProviderRateLimit $SignalText)) {
        [Console]::Error.WriteLine("Provider unavailable: rate limit for $Model.")
        exit 175
    }

    if (Test-ProviderUnavailable $SignalText) {
        [Console]::Error.WriteLine("Provider unavailable: upstream/capacity/protocol failure for $Model.")
        exit 175
    }

    $ExitCode = 1
    try { $ExitCode = [int]$Child.ExitCode } catch {}

    exit $ExitCode
} finally {
    Exit-FixUpPlaywrightProfile
    [Console]::Error.WriteLine("FixUp raw logs: $StdoutFile $StderrFile")
    Remove-Item -LiteralPath $StdinFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_GATE_CORE -ErrorAction SilentlyContinue
    Remove-Item Env:FIXUP_GATE_ARGS -ErrorAction SilentlyContinue
}
