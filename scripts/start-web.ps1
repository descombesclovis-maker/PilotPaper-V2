$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# Local development is explicitly a TEST path: keep the first OpenAI image,
# skip expensive autonomous QA/regeneration loops, and allow unverified export.
$env:DP_TEST_EXPORT = "true"
$env:DP_TEST_FAST = "true"
$env:DP_MAX_RETRIES = "0"

$RuntimeDir = Join-Path $ProjectRoot ".pilotpaper-runtime"
[IO.Directory]::CreateDirectory($RuntimeDir) | Out-Null
$LogFile = Join-Path $RuntimeDir "pilotpaper-latest.log"
$ArchiveFile = Join-Path $RuntimeDir ("pilotpaper-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

"===== PilotPaper local session $(Get-Date -Format o) =====" | Out-File -FilePath $LogFile -Encoding utf8
Write-Host "[PilotPaper] Journal : $LogFile"

& npm.cmd run dev *>&1 | Tee-Object -FilePath $LogFile -Append | Tee-Object -FilePath $ArchiveFile -Append
$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
  throw "L'interface PilotPaper s'est arrêtée avec le code $ExitCode. Consultez $LogFile"
}
