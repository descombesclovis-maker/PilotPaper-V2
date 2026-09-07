$ErrorActionPreference = "Stop"
$RestartScript = Join-Path $PSScriptRoot "restart-pilotpaper.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $RestartScript
exit $LASTEXITCODE
