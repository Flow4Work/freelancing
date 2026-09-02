param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,
  [string]$Branch = "feat/fixup-scout-foundation",
  [string]$SourceRef = ""
)

$ErrorActionPreference = "Stop"

function Assert-NativeOk([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed (exit $LASTEXITCODE)"
  }
}

if (-not (Test-Path -LiteralPath $Repo)) {
  throw "Repository path not found: $Repo"
}

& git -C $Repo fetch origin --prune
Assert-NativeOk "git fetch"

$RemoteRef = "origin/$Branch"
$RemoteHead = (& git -C $Repo rev-parse $RemoteRef).Trim()
Assert-NativeOk "remote HEAD"
$LocalHead = (& git -C $Repo rev-parse HEAD).Trim()
Assert-NativeOk "local HEAD"

if ([string]::IsNullOrWhiteSpace($SourceRef)) {
  $SourceRef = $RemoteHead
}
& git -C $Repo cat-file -e "${SourceRef}^{commit}"
Assert-NativeOk "source commit"

$UiRel = "src/components/discovery-console.tsx"
$HistoryComponentRel = "src/components/automation-history.tsx"
$HistoryRouteRel = "src/app/api/automation/history/route.ts"
$LauncherRel = "src/lib/automation/opencode-launcher.ts"

$UiDirty = @(& git -C $Repo status --porcelain=v1 --untracked-files=all -- $UiRel)
Assert-NativeOk "UI status"
if ($UiDirty.Count -gt 0) {
  Write-Host "Local changes exist in discovery-console.tsx. Nothing was overwritten." -ForegroundColor Red
  $UiDirty | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  throw "Target UI file has local changes"
}

$TempRoot = Join-Path $env:TEMP ("fixup-history-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

$UiPath = Join-Path $Repo ($UiRel -replace "/", "\")
$UiBackup = Join-Path $TempRoot "discovery-console.tsx"
Copy-Item -LiteralPath $UiPath -Destination $UiBackup -Force

$CreatedPaths = New-Object System.Collections.Generic.List[string]
$Backups = @{}

try {
  foreach ($Rel in @($HistoryComponentRel, $HistoryRouteRel)) {
    $Spec = "${SourceRef}:$Rel"
    $Target = Join-Path $Repo ($Rel -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null

    if (Test-Path -LiteralPath $Target) {
      $Backup = Join-Path $TempRoot ((Split-Path -Leaf $Target) + ".bak")
      Copy-Item -LiteralPath $Target -Destination $Backup -Force
      $Backups[$Target] = $Backup
    } else {
      $CreatedPaths.Add($Target) | Out-Null
    }

    & git -C $Repo show "--output=$Target" $Spec
    Assert-NativeOk "git show $Rel"
    if (-not (Test-Path -LiteralPath $Target)) {
      throw "Failed to materialize $Rel"
    }
  }

  $Ui = [IO.File]::ReadAllText($UiPath)
  $ImportLine = 'import { AutomationHistory } from "@/components/automation-history";'
  if (-not $Ui.Contains($ImportLine)) {
    $ImportAnchor = 'import { useEffect, useMemo, useState } from "react";'
    if (-not $Ui.Contains($ImportAnchor)) {
      throw "React import anchor not found"
    }
    $Ui = $Ui.Replace($ImportAnchor, $ImportAnchor + "`r`n" + $ImportLine)
  }

  if (-not $Ui.Contains('<AutomationHistory category={category} />')) {
    $Needle = '<button className="primary" onClick={runDiscovery} disabled={loading}>'
    $ButtonStart = $Ui.IndexOf($Needle, [StringComparison]::Ordinal)
    if ($ButtonStart -lt 0) {
      throw "runDiscovery button not found"
    }

    $ButtonEnd = $Ui.IndexOf('</button>', $ButtonStart, [StringComparison]::Ordinal)
    if ($ButtonEnd -lt 0) {
      throw "runDiscovery button end not found"
    }
    $ButtonEnd += '</button>'.Length

    $LineStart = $Ui.LastIndexOf("`n", $ButtonStart)
    if ($LineStart -lt 0) { $LineStart = 0 } else { $LineStart += 1 }

    $LineEnd = $Ui.IndexOf("`n", $ButtonEnd)
    if ($LineEnd -lt 0) { $LineEnd = $Ui.Length }

    $IndentLength = $ButtonStart - $LineStart
    $Indent = $Ui.Substring($LineStart, $IndentLength)
    $Button = $Ui.Substring($ButtonStart, $ButtonEnd - $ButtonStart)
    $Button = $Button.Replace('<button className="primary"', '<button className="primary" style={{ marginLeft: 0 }}')

    $Replacement = $Indent + '<div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>' + "`r`n" +
      $Indent + '  <AutomationHistory category={category} />' + "`r`n" +
      $Indent + '  ' + $Button + "`r`n" +
      $Indent + '</div>'

    $Before = $Ui.Substring(0, $LineStart)
    $After = $Ui.Substring($LineEnd)
    $Ui = $Before + $Replacement + $After
  }

  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($UiPath, $Ui, $Utf8NoBom)

  $UpdatedUi = [IO.File]::ReadAllText($UiPath)
  if (-not $UpdatedUi.Contains('<AutomationHistory category={category} />')) {
    throw "History control was not inserted"
  }

  $LauncherPath = Join-Path $Repo ($LauncherRel -replace "/", "\")
  $Launcher = [IO.File]::ReadAllText($LauncherPath)
  if ($Launcher.Contains("--model") -or $Launcher.Contains("getFixUpOpenCodeModel")) {
    throw "Launcher contains an unexpected model override"
  }
  if (-not $Launcher.Contains('--file $PromptFile')) {
    throw "Launcher does not contain the proven --file path"
  }

  Write-Host "[FixUp Scout] Running TypeScript typecheck..." -ForegroundColor Cyan
  & npm.cmd --prefix $Repo run typecheck
  Assert-NativeOk "npm run typecheck"

  $Listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  foreach ($ProcessId in @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  }
  Start-Sleep -Milliseconds 700

  $NextCache = Join-Path $Repo ".next"
  if (Test-Path -LiteralPath $NextCache) {
    Remove-Item -LiteralPath $NextCache -Recurse -Force
  }

  $RepoEscaped = $Repo.Replace("'", "''")
  $DevCommand = "Set-Location -LiteralPath '$RepoEscaped'; & npm.cmd run dev"
  $null = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo",
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $DevCommand
  ) -WorkingDirectory $Repo -PassThru

  $Ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 2
      if ($null -ne $Health) {
        $Ready = $true
        break
      }
    } catch {}
  }
  if (-not $Ready) {
    throw "localhost:3000 did not become ready"
  }

  $History = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/automation/history?category=beauty" -Method Get -TimeoutSec 15
  if (-not $History.ok) {
    throw "History API validation failed"
  }

  Write-Host ""
  Write-Host "[FixUp Scout] History control and API are active." -ForegroundColor Green
  Write-Host "local HEAD:  $LocalHead" -ForegroundColor DarkGray
  Write-Host "remote HEAD: $RemoteHead" -ForegroundColor DarkGray
  Write-Host "source ref:  $SourceRef" -ForegroundColor DarkGray
  Write-Host "Local candidates.ts was not modified." -ForegroundColor Green
  Write-Host "History items: $(@($History.items).Count)" -ForegroundColor Green
  Start-Process "http://localhost:3000"
}
catch {
  Copy-Item -LiteralPath $UiBackup -Destination $UiPath -Force

  foreach ($Target in $Backups.Keys) {
    Copy-Item -LiteralPath $Backups[$Target] -Destination $Target -Force
  }
  foreach ($Path in $CreatedPaths) {
    if (Test-Path -LiteralPath $Path) {
      Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
  }
  throw
}
finally {
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
