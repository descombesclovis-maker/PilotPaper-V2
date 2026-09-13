param(
  [switch]$ProductionValidation
)

$ErrorActionPreference = "Stop"
Write-Host "[PilotPaper] Version Site Twin V2"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if ($ProductionValidation) {
  $WebStarter = Join-Path $PSScriptRoot "start-web-validation.ps1"
} else {
  $WebStarter = Join-Path $PSScriptRoot "start-web.ps1"
}
$GeometryStarter = Join-Path $PSScriptRoot "start-geometry-engine.ps1"
$StateDir = Join-Path $ProjectRoot ".pilotpaper-runtime"
$PidFile = Join-Path $StateDir "web.pid"
[IO.Directory]::CreateDirectory($StateDir) | Out-Null

function Stop-PreviousPilotPaper {
  if (-not (Test-Path $PidFile)) { return }
  try {
    $OldPid = [int](Get-Content $PidFile -Raw)
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$OldPid" -ErrorAction SilentlyContinue
    if ($Process -and ([string]$Process.CommandLine).IndexOf($ProjectRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
      taskkill.exe /PID $OldPid /T /F *> $null
    }
  } catch {}
}
function Wait-ForWeb {
  for ($Attempt=0; $Attempt -lt 120; $Attempt++) {
    Start-Sleep -Seconds 1
    try {
      $Page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173/" -TimeoutSec 3
      if ($Page.StatusCode -eq 200) { return }
    } catch {}
  }
  throw "PilotPaper n'est pas pret apres deux minutes."
}

Set-Location $ProjectRoot
Stop-PreviousPilotPaper
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Node.js/npm est introuvable. Installez Node.js 22.13 ou superieur." }
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "[PilotPaper] Installation des dependances..."
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "npm install a echoue." }
}
if (-not (Test-Path (Join-Path $ProjectRoot ".dev.vars"))) {
  Write-Host "[PilotPaper] Configuration de la cle OpenAI..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "configure-openai.ps1")
  if ($LASTEXITCODE -ne 0) { throw "La configuration OpenAI a echoue." }
}

Write-Host "[PilotPaper] Demarrage du moteur geometrique Site Twin..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $GeometryStarter
if ($LASTEXITCODE -ne 0) { throw "Le moteur geometrique Site Twin n'a pas demarre." }
$env:PILOTPAPER_GEOMETRY_ENGINE_URL = "http://127.0.0.1:8765"

if ($ProductionValidation) {
  Write-Host "[PilotPaper] Demarrage en VALIDATION V1 STRICTE : QA complet, aucun export test implicite."
} else {
  Write-Host "[PilotPaper] Demarrage de l'application avec Property Lock + Site Twin + moteur geometrique integre..."
}
$Web = Start-Process -FilePath "powershell" -PassThru -WindowStyle Minimized -WorkingDirectory $ProjectRoot -ArgumentList @("-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-File",('"'+$WebStarter+'"'))
[IO.File]::WriteAllText($PidFile,[string]$Web.Id)
Wait-ForWeb
Start-Process "http://localhost:5173"
if ($ProductionValidation) {
  Write-Host "[PilotPaper] Pret pour le dossier temoin V1 en mode production strict."
} else {
  Write-Host "[PilotPaper] Pret. Site Twin V2 est la source geometrique canonique en cours de validation."
}
