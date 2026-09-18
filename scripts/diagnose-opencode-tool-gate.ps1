$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP 'fixup-scout-diagnostic'
$Model = 'mistral/mistral-small-2603'
$TimeoutSeconds = 45

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

$MistralKey = Get-EnvLocalValue -Name 'MISTRAL_API_KEY'
if ([string]::IsNullOrWhiteSpace($MistralKey)) { throw 'MISTRAL_API_KEY missing.' }
$env:MISTRAL_API_KEY = $MistralKey

function Redact-Text {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return '' }
    return $Text.Replace($MistralKey, '[REDACTED]')
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

function Invoke-Captured {
    param(
        [Parameter(Mandatory=$true)][string]$Tag,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [int]$TimeoutSec = 45
    )

    $StdoutFile = Join-Path $TempRoot ($Tag + '.stdout.log')
    $StderrFile = Join-Path $TempRoot ($Tag + '.stderr.log')
    Remove-Item -LiteralPath $StdoutFile,$StderrFile -Force -ErrorAction SilentlyContinue

    $Started = [DateTime]::UtcNow
    $Process = Start-Process -FilePath $OpenCodeExe `
        -ArgumentList $Arguments `
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

    $Elapsed = [Math]::Round(([DateTime]::UtcNow - $Started).TotalSeconds, 1)
    $Stdout = if (Test-Path -LiteralPath $StdoutFile) { Get-Content -LiteralPath $StdoutFile -Raw -ErrorAction SilentlyContinue } else { '' }
    $Stderr = if (Test-Path -LiteralPath $StderrFile) { Get-Content -LiteralPath $StderrFile -Raw -ErrorAction SilentlyContinue } else { '' }
    $Stdout = Redact-Text ([string]$Stdout)
    $Stderr = Redact-Text ([string]$Stderr)

    [IO.File]::WriteAllText((Join-Path $TempRoot ($Tag + '.combined.log')), ($Stdout + [Environment]::NewLine + $Stderr), (New-Object Text.UTF8Encoding($false)))

    return [pscustomobject]@{
        Tag = $Tag
        ExitCode = $ExitCode
        TimedOut = $TimedOut
        ElapsedSeconds = $Elapsed
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

$OpenCodeExe = Resolve-OpenCodeExecutable
$Head = (git rev-parse HEAD).Trim()

Write-Host '[FixUp Scout] fast tool-gate diagnosis' -ForegroundColor Cyan
Write-Host "LOCAL_HEAD=$Head"
Write-Host "OPENCODE_VERSION=$((& $OpenCodeExe --version 2>$null | Select-Object -First 1))"
Write-Host "MODEL=$Model"
Write-Host 'A_TEST=SKIPPED_ALREADY_PROVEN'
Write-Host 'NVIDIA_TEST=SKIPPED_FOR_SPEED'
Write-Host 'SCOUT_E2E=NOT_RUN'

Write-Host ''
Write-Host 'STEP_1=MCP_LIST' -ForegroundColor Green
$Mcp = Invoke-Captured -Tag 'tool-gate-mcp-list' -Arguments @('mcp','list') -TimeoutSec 20
Write-Host "MCP_EXIT=$($Mcp.ExitCode) timeout=$($Mcp.TimedOut) elapsed_s=$($Mcp.ElapsedSeconds) log=$($Mcp.Log)"
Write-Host 'MCP_OUTPUT_BEGIN'
if ([string]::IsNullOrWhiteSpace($Mcp.Stdout) -and [string]::IsNullOrWhiteSpace($Mcp.Stderr)) {
    Write-Host '<EMPTY>'
} else {
    if (-not [string]::IsNullOrWhiteSpace($Mcp.Stdout)) { Write-Host $Mcp.Stdout.TrimEnd() }
    if (-not [string]::IsNullOrWhiteSpace($Mcp.Stderr)) { Write-Host $Mcp.Stderr.TrimEnd() }
}
Write-Host 'MCP_OUTPUT_END'
$McpCombined = (($Mcp.Stdout + [Environment]::NewLine + $Mcp.Stderr))
$HasPlaywrightMcp = $McpCombined -match '(?i)playwright|browser'
$HasConnectedMcp = $McpCombined -match '(?i)connected'
Write-Host "MCP_HAS_PLAYWRIGHT_OR_BROWSER=$HasPlaywrightMcp"
Write-Host "MCP_HAS_CONNECTED_SERVER=$HasConnectedMcp"

Write-Host ''
Write-Host 'STEP_2=MISTRAL_B_WITH_PERMISSION_BYPASS' -ForegroundColor Green
$Prompt = 'Use exactly one available Playwright or browser tool call to read only the title of the current page. Do not click, type, or navigate. After the tool returns, reply exactly B_OK: <title>.'
$QuotedPrompt = '"' + $Prompt + '"'
$B = Invoke-Captured -Tag 'tool-gate-mistral-B-permission-bypass' -Arguments @('run',$QuotedPrompt,'--model',$Model,'--format','json','--dangerously-skip-permissions') -TimeoutSec $TimeoutSeconds
$Events = @(Get-JsonEvents -Text $B.Stdout)
$ToolEvents = @($Events | Where-Object { [string]$_.type -eq 'tool_use' })
$ToolNames = @($ToolEvents | ForEach-Object { [string]$_.part.tool })
$BrowserTools = @($ToolEvents | Where-Object { [string]$_.part.tool -match '(?i)playwright|browser' })
$CompletedBrowser = @($BrowserTools | Where-Object { [string]$_.part.state.status -eq 'completed' })
$Errors = @($Events | Where-Object { [string]$_.type -eq 'error' })
$Text = Get-TextOutput -Events $Events

Write-Host "B_EXIT=$($B.ExitCode) timeout=$($B.TimedOut) elapsed_s=$($B.ElapsedSeconds) events=$($Events.Count) errors=$($Errors.Count) tools=$($ToolEvents.Count) browser_tools=$($BrowserTools.Count) completed_browser=$($CompletedBrowser.Count)"
Write-Host ('B_TOOL_NAMES=' + $(if ($ToolNames.Count -gt 0) { $ToolNames -join ',' } else { 'NONE' }))
Write-Host ('B_TEXT=' + $(if ([string]::IsNullOrWhiteSpace($Text)) { '<EMPTY>' } else { $Text }))
Write-Host "B_LOG=$($B.Log)"
if (-not [string]::IsNullOrWhiteSpace($B.Stderr)) { Write-Host ('B_STDERR=' + $B.Stderr.Trim()) }

$BPassed = (-not $B.TimedOut) -and $B.ExitCode -eq 0 -and $Errors.Count -eq 0 -and $ToolEvents.Count -eq 1 -and $CompletedBrowser.Count -eq 1 -and $Text -match '(?m)^B_OK:\s*\S.+'
Write-Host ''
Write-Host "B_PASS=$BPassed"

if ($BPassed) {
    Write-Host 'DIAGNOSIS=PREVIOUS_B_WAS_BLOCKED_BY_NONINTERACTIVE_PERMISSION_GATE' -ForegroundColor Green
    Write-Host 'NEXT=Use this evidence to minimally adjust the production OpenCode run invocation, then run the 2-account Scout E2E.'
} elseif (-not $HasPlaywrightMcp -and $ToolEvents.Count -eq 0) {
    Write-Host 'DIAGNOSIS=PLAYWRIGHT_TOOL_NOT_VISIBLE_IN_THIS_OPENCODE_RUN_CONTEXT' -ForegroundColor Red
    Write-Host 'NEXT=Compare this run context with the production Scout run context before changing provider or prompt.'
} elseif ($ToolEvents.Count -eq 0) {
    Write-Host 'DIAGNOSIS=MISTRAL_DID_NOT_EMIT_ANY_TOOL_CALL_EVEN_WITH_PERMISSION_BYPASS' -ForegroundColor Red
    Write-Host 'NEXT=Inspect actual tool exposure/config and prior production attempt logs; do not change timeout/prompt/fallback order yet.'
} else {
    Write-Host 'DIAGNOSIS=TOOL_CALL_EMITTED_BUT_DID_NOT_COMPLETE' -ForegroundColor Red
    Write-Host 'NEXT=Inspect the single B log/error before any production change.'
}

Write-Host "DIAGNOSTIC_LOG_DIR=$TempRoot"
