param([Parameter(Mandatory=$true)][string]$ScriptPath)
$source = Get-Content -LiteralPath $ScriptPath -Raw -Encoding UTF8
$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_.Message }
  exit 1
}
exit 0