$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $ProjectRoot ".pilotpaper-runtime"
$PidFile = Join-Path $StateDir "geometry.pid"
$LogFile = Join-Path $StateDir "geometry-latest.log"
$ErrorLogFile = Join-Path $StateDir "geometry-error.log"
[IO.Directory]::CreateDirectory($StateDir) | Out-Null

function Stop-PreviousGeometryEngine {
  if (-not (Test-Path $PidFile)) { return }
  try {
    $OldPid = [int](Get-Content $PidFile -Raw)
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$OldPid" -ErrorAction SilentlyContinue
    if ($Process) { taskkill.exe /PID $OldPid /T /F *> $null }
  } catch {}
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Wait-ForGeometryEngine {
  for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
      if ($Health.ok -eq $true) { return $Health }
    } catch {}
  }
  $Details = ""
  if (Test-Path $ErrorLogFile) { $Details = (Get-Content $ErrorLogFile -Tail 20 -ErrorAction SilentlyContinue) -join "`n" }
  throw "PilotPaper Geometry Engine n'est pas pret apres 30 secondes. $Details"
}

Stop-PreviousGeometryEngine
$EmbeddedExe = Join-Path $ProjectRoot "runtime/PilotPaperGeometryEngine.exe"
$DevExe = Join-Path $ProjectRoot "geometry-engine/dist/PilotPaperGeometryEngine.exe"
$GeometryRoot = Join-Path $ProjectRoot "geometry-engine"

$CommonStartArgs = @{
  WorkingDirectory = $ProjectRoot
  WindowStyle = "Hidden"
  RedirectStandardOutput = $LogFile
  RedirectStandardError = $ErrorLogFile
  PassThru = $true
}

if (Test-Path $EmbeddedExe) {
  $Process = Start-Process -FilePath $EmbeddedExe @CommonStartArgs
} elseif (Test-Path $DevExe) {
  $Process = Start-Process -FilePath $DevExe @CommonStartArgs
} else {
  $Python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $Python) { $Python = Get-Command py.exe -ErrorAction SilentlyContinue }
  if (-not $Python) {
    throw "PilotPaper Geometry Engine absent et Python introuvable. Installez Python 3.11+ ou utilisez la build Windows embarquee."
  }
  $Venv = Join-Path $GeometryRoot ".venv"
  $VenvPython = Join-Path $Venv "Scripts/python.exe"
  if (-not (Test-Path $VenvPython)) {
    Write-Host "[PilotPaper] Preparation du moteur geometrique local..."
    & $Python.Source -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Creation de l'environnement Python du moteur geometrique impossible." }
    & $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $GeometryRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Installation des dependances geometriques impossible." }
  }
  $Process = Start-Process -FilePath $VenvPython -ArgumentList @((Join-Path $GeometryRoot "run.py")) -WorkingDirectory $GeometryRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
}

[IO.File]::WriteAllText($PidFile, [string]$Process.Id)
$Health = Wait-ForGeometryEngine
$env:PILOTPAPER_GEOMETRY_ENGINE_URL = "http://127.0.0.1:8765"
Write-Host "[PilotPaper] Geometry Engine pret : $($Health.version)"
