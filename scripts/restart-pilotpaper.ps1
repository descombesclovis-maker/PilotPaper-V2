$ErrorActionPreference = "Stop"
Write-Host "[PilotPaper] Version DP-AI-FIRST v0.4.3"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WebStarter = Join-Path $PSScriptRoot "start-web.ps1"
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
Write-Host "[PilotPaper] Demarrage de l'application et du moteur DP-AI-FIRST integre..."
$Web = Start-Process -FilePath "powershell" -PassThru -WindowStyle Minimized -WorkingDirectory $ProjectRoot -ArgumentList @("-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-File",('"'+$WebStarter+'"'))
[IO.File]::WriteAllText($PidFile,[string]$Web.Id)
Wait-ForWeb
Start-Process "http://localhost:5173"
Write-Host "[PilotPaper] Pret. Aucun ancien moteur local n'est demarre."
