$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# V1 release-candidate validation must exercise the real production path.
# Never inherit the fast/unverified development overrides from another shell.
Remove-Item Env:DP_TEST_EXPORT -ErrorAction SilentlyContinue
Remove-Item Env:DP_TEST_FAST -ErrorAction SilentlyContinue
Remove-Item Env:DP_MAX_RETRIES -ErrorAction SilentlyContinue

$RuntimeDir = Join-Path $ProjectRoot ".pilotpaper-runtime"
[IO.Directory]::CreateDirectory($RuntimeDir) | Out-Null
$LogFile = Join-Path $RuntimeDir "pilotpaper-validation-latest.log"
$ArchiveFile = Join-Path $RuntimeDir ("pilotpaper-validation-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

"===== PilotPaper V1 strict validation session $(Get-Date -Format o) =====" | Out-File -FilePath $LogFile -Encoding utf8
Write-Host "[PilotPaper] Validation V1 stricte. Journal : $LogFile"
Write-Host "[PilotPaper] DP_TEST_EXPORT=OFF | DP_TEST_FAST=OFF | retries=configures dans .dev.vars"

& npm.cmd run dev *>&1 | Tee-Object -FilePath $LogFile -Append | Tee-Object -FilePath $ArchiveFile -Append
$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
  throw "L'interface PilotPaper de validation s'est arretee avec le code $ExitCode. Consultez $LogFile"
}
