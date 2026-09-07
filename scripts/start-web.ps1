$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
& npm.cmd run dev
if ($LASTEXITCODE -ne 0) {
  throw "L'interface PilotPaper s'est arrêtée avec le code $LASTEXITCODE."
}
