param(
  [string]$Repo = "C:\Users\동호\freelancing",
  [string]$Branch = "feat/fixup-scout-foundation"
)

$ErrorActionPreference = "Stop"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
try { chcp 65001 > $null } catch {}

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Read-HiddenValue([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path -LiteralPath $Path) {
    $lines = [IO.File]::ReadAllLines($Path)
  }

  $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="
  $out = New-Object "System.Collections.Generic.List[string]"
  $written = $false

  foreach ($line in $lines) {
    if ($line -match $pattern) {
      if (-not $written) {
        $out.Add("$Key=$Value")
        $written = $true
      }
    } else {
      $out.Add($line)
    }
  }

  if (-not $written) { $out.Add("$Key=$Value") }
  [IO.File]::WriteAllLines($Path, $out.ToArray(), $Utf8)
}

if (-not (Test-Path -LiteralPath (Join-Path $Repo ".git"))) {
  throw "Git 저장소를 찾지 못했습니다: $Repo"
}

Write-Host "`n[1/6] 현재 상태 확인" -ForegroundColor Cyan
& git -C $Repo fetch origin --prune
Assert-LastExitCode "git fetch 실패"

$currentBranch = (& git -C $Repo branch --show-current).Trim()
Assert-LastExitCode "현재 브랜치 확인 실패"
if ($currentBranch -ne $Branch) {
  throw "현재 브랜치가 다릅니다. 현재: $currentBranch / 필요: $Branch"
}

$localHead = (& git -C $Repo rev-parse HEAD).Trim()
Assert-LastExitCode "local HEAD 확인 실패"
$originRef = "origin/$Branch"
$originHead = (& git -C $Repo rev-parse $originRef).Trim()
Assert-LastExitCode "origin HEAD 확인 실패"

Write-Host "Local HEAD : $localHead"
Write-Host "Origin HEAD: $originHead"
Write-Host "현재 변경 파일:"
& git -C $Repo status --short
Assert-LastExitCode "git status 실패"

if ($localHead -ne $originHead) {
  & git -C $Repo merge-base --is-ancestor $localHead $originRef
  $ancestor = $LASTEXITCODE
  if ($ancestor -eq 1) {
    throw "로컬 커밋과 origin이 갈라져 있습니다. 자동 덮어쓰기를 하지 않습니다."
  }
  if ($ancestor -ne 0) { throw "git merge-base 확인 실패" }
}

Write-Host "`n[2/6] 로컬 변경 안전 보존 후 최신 코드 반영" -ForegroundColor Cyan
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$preserveRoot = Join-Path $env:TEMP "fixup-scout-preserve-$stamp"
$movedUntracked = New-Object "System.Collections.Generic.List[string]"
$preservedDifferences = New-Object "System.Collections.Generic.List[string]"

# 현재 로컬에서는 untracked지만 최신 origin에서는 tracked가 된 파일은 stash 복원 시 충돌한다.
# origin의 tracked 경로를 한 번만 읽어 HashSet으로 비교한다.
# 존재하지 않는 경로 조회를 위해 git cat-file -e를 호출하지 않는다.
$originTrackedPaths = @(& git -C $Repo -c core.quotePath=false ls-tree -r --name-only $originRef)
Assert-LastExitCode "origin tracked 파일 목록 확인 실패"
$originTracked = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::Ordinal)
foreach ($trackedPathRaw in $originTrackedPaths) {
  $trackedPath = $trackedPathRaw.Trim()
  if ($trackedPath) { [void]$originTracked.Add($trackedPath) }
}

# 먼저 repo 밖 TEMP로 옮겨 원본을 보존하고, 최신 코드 반영 후 동일 여부를 비교한다.
$untrackedPaths = @(& git -C $Repo -c core.quotePath=false ls-files --others --exclude-standard)
Assert-LastExitCode "untracked 파일 확인 실패"
foreach ($gitPathRaw in $untrackedPaths) {
  $gitPath = $gitPathRaw.Trim()
  if (-not $gitPath) { continue }

  if ($originTracked.Contains($gitPath)) {
    $sourcePath = Join-Path $Repo ($gitPath -replace "/", "\")
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }

    $backupPath = Join-Path $preserveRoot ($gitPath -replace "/", "\")
    $backupParent = Split-Path -Parent $backupPath
    if ($backupParent) { New-Item -ItemType Directory -Force -Path $backupParent | Out-Null }
    Move-Item -LiteralPath $sourcePath -Destination $backupPath -Force
    $movedUntracked.Add($gitPath)
    Write-Host "origin과 겹치는 untracked 원본 임시 보존: $gitPath" -ForegroundColor DarkGray
  }
}

$statusLines = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)
Assert-LastExitCode "로컬 변경 확인 실패"
$stashRef = $null
$stashCommit = $null

if ($statusLines.Count -gt 0) {
  $stashMessage = "fixup-scout-auto-sync-$stamp"
  & git -C $Repo stash push --include-untracked -m $stashMessage
  Assert-LastExitCode "로컬 변경 임시 보존 실패"

  $stashLine = @(& git -C $Repo stash list --format="%gd|%H|%s" | Where-Object { $_ -like "*$stashMessage*" } | Select-Object -First 1)
  Assert-LastExitCode "stash 확인 실패"
  if (-not $stashLine) { throw "로컬 변경을 보존했지만 stash 참조를 확인하지 못했습니다." }
  $stashParts = $stashLine[0] -split "\|", 3
  $stashRef = $stashParts[0]
  $stashCommit = $stashParts[1]
  Write-Host "로컬 변경 임시 보존 완료: $stashRef" -ForegroundColor DarkGray
}

try {
  if ($localHead -ne $originHead) {
    & git -C $Repo merge --ff-only $originRef
    Assert-LastExitCode "origin 최신 코드 fast-forward 실패"
  }

  if ($stashCommit) {
    & git -C $Repo stash apply --index $stashCommit
    if ($LASTEXITCODE -ne 0) {
      Write-Host "`n실제 3-way 충돌 파일:" -ForegroundColor Yellow
      & git -C $Repo status --short
      Write-Host "`n로컬 변경은 $stashRef 에 그대로 보존되어 있습니다." -ForegroundColor Yellow
      throw "실제 코드 충돌이 발생했습니다. 자동으로 어느 쪽도 버리지 않았습니다."
    }

    & git -C $Repo stash drop $stashRef
    Assert-LastExitCode "적용 완료 후 임시 stash 정리 실패"
    Write-Host "기존 tracked/untracked 로컬 변경 재적용 완료" -ForegroundColor Green
  }

  # 최신 origin에 새로 생긴 파일과 이전 untracked 파일이 동일하면 최신 tracked 파일을 그대로 사용한다.
  # 다르면 이전 로컬 파일은 TEMP에 남겨 데이터 유실 없이 최신 origin 파일을 사용한다.
  foreach ($gitPath in $movedUntracked) {
    $backupPath = Join-Path $preserveRoot ($gitPath -replace "/", "\")
    $currentPath = Join-Path $Repo ($gitPath -replace "/", "\")
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { continue }

    if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
      $oldHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
      $newHash = (Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash
      if ($oldHash -eq $newHash) {
        Remove-Item -LiteralPath $backupPath -Force
      } else {
        $preservedDifferences.Add($gitPath)
      }
    } else {
      $currentParent = Split-Path -Parent $currentPath
      if ($currentParent) { New-Item -ItemType Directory -Force -Path $currentParent | Out-Null }
      Copy-Item -LiteralPath $backupPath -Destination $currentPath
    }
  }
} catch {
  if ($stashRef) { Write-Host "보존된 로컬 변경: $stashRef" -ForegroundColor Yellow }
  if ($movedUntracked.Count -gt 0) { Write-Host "보존된 untracked 원본: $preserveRoot" -ForegroundColor Yellow }
  throw
}

if ($preservedDifferences.Count -gt 0) {
  Write-Host "`n최신 origin과 내용이 다른 이전 untracked 파일은 덮어쓰지 않고 TEMP에 보존했습니다:" -ForegroundColor Yellow
  foreach ($gitPath in $preservedDifferences) { Write-Host " - $gitPath" }
  Write-Host "보존 위치: $preserveRoot" -ForegroundColor Yellow
} elseif (Test-Path -LiteralPath $preserveRoot) {
  Remove-Item -LiteralPath $preserveRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$afterHead = (& git -C $Repo rev-parse HEAD).Trim()
Assert-LastExitCode "반영 후 HEAD 확인 실패"
if ($afterHead -ne $originHead) {
  throw "반영 후 HEAD가 origin과 일치하지 않습니다. HEAD: $afterHead / origin: $originHead"
}

Write-Host "코드 반영 완료: $afterHead" -ForegroundColor Green

Write-Host "`n[3/6] DM API Key 설정" -ForegroundColor Cyan
& git -C $Repo check-ignore -q ".env.local"
if ($LASTEXITCODE -ne 0) {
  throw ".env.local이 Git ignore 대상이 아닙니다. API Key 보호를 위해 중단합니다."
}

$envPath = Join-Path $Repo ".env.local"
if (-not (Test-Path -LiteralPath $envPath)) {
  $example = Join-Path $Repo ".env.example"
  if (Test-Path -LiteralPath $example) {
    Copy-Item -LiteralPath $example -Destination $envPath
  } else {
    [IO.File]::WriteAllText($envPath, "", $Utf8)
  }
}

$groqKey = Read-HiddenValue "Groq API Key 입력"
$scwSecret = Read-HiddenValue "Scaleway Secret Key 입력"
if ([string]::IsNullOrWhiteSpace($groqKey)) { throw "Groq API Key가 비어 있습니다." }
if ([string]::IsNullOrWhiteSpace($scwSecret)) { throw "Scaleway Secret Key가 비어 있습니다." }

Set-EnvValue $envPath "GROQ_API_KEY" $groqKey
Set-EnvValue $envPath "SCW_ACCESS_KEY" "SCWKMY5WVEPR9SV4NQBN"
Set-EnvValue $envPath "SCW_SECRET_KEY" $scwSecret
Set-EnvValue $envPath "DM_LLM_TIMEOUT_MS" "10000"
$groqKey = $null
$scwSecret = $null
Write-Host ".env.local 기존 설정 유지 + DM 키 업데이트 완료" -ForegroundColor Green

Write-Host "`n[4/6] TypeScript 검증" -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js를 찾지 못했습니다."
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo "node_modules"))) {
  & npm --prefix $Repo install
  Assert-LastExitCode "npm install 실패"
}
& npm --prefix $Repo run typecheck
Assert-LastExitCode "TypeScript 검증 실패"
Write-Host "TypeScript 검증 완료" -ForegroundColor Green

Write-Host "`n[5/6] 기존 localhost:3000 정리" -ForegroundColor Cyan
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  $ownerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -and $_ -ne $PID })
  foreach ($ownerPid in $ownerPids) {
    $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host "기존 3000 프로세스 종료: $($process.ProcessName) PID $ownerPid"
      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    }
  }
}

$nextPath = Join-Path $Repo ".next"
if (Test-Path -LiteralPath $nextPath) {
  Remove-Item -LiteralPath $nextPath -Recurse -Force
}

Write-Host "`n[6/6] FixUp Scout 실행" -ForegroundColor Cyan
$devScript = Join-Path $Repo "scripts\dev.ps1"
if (-not (Test-Path -LiteralPath $devScript)) { throw "scripts\dev.ps1을 찾지 못했습니다." }

$launcher = Join-Path $env:TEMP "fixup-scout-launch.ps1"
$escapedRepo = $Repo.Replace("'", "''")
$escapedDev = $devScript.Replace("'", "''")
$launcherBody = "`$ErrorActionPreference='Stop'; Set-Location -LiteralPath '$escapedRepo'; & '$escapedDev' -SkipInstall"
$BomUtf8 = New-Object System.Text.UTF8Encoding($true)
[IO.File]::WriteAllText($launcher, $launcherBody, $BomUtf8)

$devProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoLogo",
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $launcher
) -WorkingDirectory $Repo -WindowStyle Normal -PassThru

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if ($devProcess.HasExited) { break }
  try {
    $health = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {}
}

if (-not $ready) {
  throw "localhost:3000 실행 확인 실패. 새 PowerShell 창의 앱 로그를 확인하세요."
}

Write-Host "`n완료" -ForegroundColor Green
Write-Host "HEAD : $afterHead"
Write-Host "APP  : http://localhost:3000" -ForegroundColor Green
Start-Process "http://localhost:3000"
