param(
  [string]$Repo = "C:\Users\동호\freelancing",
  [string]$Branch = "feat/fixup-scout-foundation"
)

$ErrorActionPreference = "Stop"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
try { chcp 65001 > $null } catch {}

function Assert-NativeOk([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step 실패 (exit $LASTEXITCODE)" }
}

if (-not (Test-Path -LiteralPath $Repo)) { throw "저장소가 없습니다: $Repo" }

& git -C $Repo fetch origin --prune
Assert-NativeOk "git fetch"

$RemoteRef = "origin/$Branch"
$RemoteHead = (& git -C $Repo rev-parse $RemoteRef).Trim()
Assert-NativeOk "remote HEAD 확인"
$LocalHead = (& git -C $Repo rev-parse HEAD).Trim()
Assert-NativeOk "local HEAD 확인"

$UiRel = "src/components/discovery-console.tsx"
$HistoryComponentRel = "src/components/automation-history.tsx"
$HistoryRouteRel = "src/app/api/automation/history/route.ts"
$LauncherRel = "src/lib/automation/opencode-launcher.ts"

$UiDirty = @(& git -C $Repo status --porcelain=v1 --untracked-files=all -- $UiRel)
Assert-NativeOk "UI 로컬 변경 확인"
if ($UiDirty.Count -gt 0) {
  Write-Host "이번 수정 대상 UI에 로컬 변경이 있어 덮어쓰지 않습니다." -ForegroundColor Red
  $UiDirty | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  throw "discovery-console.tsx 충돌로 중단"
}

$TempRoot = Join-Path $env:TEMP ("fixup-history-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
$UiPath = Join-Path $Repo ($UiRel -replace "/", "\")
$UiBackup = Join-Path $TempRoot "discovery-console.tsx"
Copy-Item -LiteralPath $UiPath -Destination $UiBackup -Force

$CreatedPaths = New-Object System.Collections.Generic.List[string]

try {
  foreach ($Rel in @($HistoryComponentRel, $HistoryRouteRel)) {
    $Spec = "${RemoteRef}:$Rel"
    $Lines = @(& git -C $Repo show $Spec)
    Assert-NativeOk "remote 파일 읽기: $Rel"
    $Target = Join-Path $Repo ($Rel -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    [IO.File]::WriteAllText($Target, (($Lines -join "`n") + "`n"), $Utf8)
    $CreatedPaths.Add($Target) | Out-Null
  }

  $Ui = [IO.File]::ReadAllText($UiPath)
  if (-not $Ui.Contains('import { AutomationHistory } from "@/components/automation-history";')) {
    $ImportAnchor = 'import { useEffect, useMemo, useState } from "react";'
    if (-not $Ui.Contains($ImportAnchor)) { throw "UI import 위치를 찾지 못했습니다." }
    $Ui = $Ui.Replace($ImportAnchor, $ImportAnchor + "`r`n" + 'import { AutomationHistory } from "@/components/automation-history";')
  }

  if (-not $Ui.Contains('<AutomationHistory category={category} />')) {
    $Button = '          <button className="primary" onClick={runDiscovery} disabled={loading}>{loading ? "찾는 중…" : candidates.length ? "+ 추가 찾기" : "후보 찾기"}</button>'
    if (-not $Ui.Contains($Button)) { throw "추가 찾기 버튼 위치를 찾지 못했습니다." }
    $Replacement = @'
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <AutomationHistory category={category} />
            <button className="primary" style={{ marginLeft: 0 }} onClick={runDiscovery} disabled={loading}>{loading ? "찾는 중…" : candidates.length ? "+ 추가 찾기" : "후보 찾기"}</button>
          </div>
'@
    $Ui = $Ui.Replace($Button, $Replacement.TrimEnd([char[]]"`r`n"))
  }

  [IO.File]::WriteAllText($UiPath, $Ui, $Utf8)

  $UpdatedUi = [IO.File]::ReadAllText($UiPath)
  if (-not $UpdatedUi.Contains('<AutomationHistory category={category} />')) { throw "기록 버튼 UI 반영 검증 실패" }

  $LauncherPath = Join-Path $Repo ($LauncherRel -replace "/", "\")
  $Launcher = [IO.File]::ReadAllText($LauncherPath)
  if ($Launcher.Contains("--model") -or $Launcher.Contains("getFixUpOpenCodeModel")) {
    throw "현재 launcher에 모델 강제가 남아 있습니다. 자동으로 건드리지 않고 중단합니다."
  }
  if (-not $Launcher.Contains('--file $PromptFile')) { throw "정상 OpenCode --file 실행 구조를 찾지 못했습니다." }

  Write-Host "[FixUp Scout] TypeScript 확인 중..." -ForegroundColor Cyan
  & npm.cmd --prefix $Repo run typecheck
  Assert-NativeOk "npm run typecheck"

  $Listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  foreach ($ProcessId in @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  }
  Start-Sleep -Milliseconds 700

  $NextCache = Join-Path $Repo ".next"
  if (Test-Path -LiteralPath $NextCache) { Remove-Item -LiteralPath $NextCache -Recurse -Force }

  $RepoEscaped = $Repo.Replace("'", "''")
  $DevCommand = "Set-Location -LiteralPath '$RepoEscaped'; & npm.cmd run dev"
  $null = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $DevCommand
  ) -WorkingDirectory $Repo -PassThru

  $Ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 2
      if ($null -ne $Health) { $Ready = $true; break }
    } catch {}
  }
  if (-not $Ready) { throw "localhost:3000 기동 확인 실패" }

  $History = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/automation/history?category=beauty" -Method Get -TimeoutSec 15
  if (-not $History.ok) { throw "기록 API 검증 실패" }

  Write-Host ""
  Write-Host "[FixUp Scout] 기록 버튼/기록 API 반영 완료" -ForegroundColor Green
  Write-Host "local HEAD:  $LocalHead" -ForegroundColor DarkGray
  Write-Host "remote HEAD: $RemoteHead" -ForegroundColor DarkGray
  Write-Host "src/lib/supabase/candidates.ts 로컬 변경은 건드리지 않았습니다." -ForegroundColor Green
  Write-Host "기록 API: $(@($History.items).Count)건" -ForegroundColor Green
  Start-Process "http://localhost:3000"
}
catch {
  Copy-Item -LiteralPath $UiBackup -Destination $UiPath -Force
  foreach ($Path in $CreatedPaths) {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
  }
  throw
}
finally {
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
