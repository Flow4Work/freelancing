param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js가 없습니다. Node.js 20.9 이상을 설치한 뒤 다시 실행하세요."
}

$RawVersion = (& node --version).Trim().TrimStart('v')
$NodeVersion = [version]$RawVersion
if ($NodeVersion -lt [version]"20.9.0") {
  throw "Node.js 20.9 이상이 필요합니다. 현재: $RawVersion"
}

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "[FixUp Scout] .env.local 생성 완료. API 키를 넣으면 검색이 활성화됩니다." -ForegroundColor Yellow
}

if (-not $SkipInstall -and -not (Test-Path "node_modules")) {
  Write-Host "[FixUp Scout] npm install 실행 중..." -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 실패" }
}

Write-Host "[FixUp Scout] http://localhost:3000" -ForegroundColor Green
& npm run dev
