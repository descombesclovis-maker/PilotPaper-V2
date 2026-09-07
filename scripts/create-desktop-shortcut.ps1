$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $ProjectRoot "DEMARRER-PILOTPAPER.cmd"
if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "Le lanceur PilotPaper est introuvable."
}
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "PilotPaper.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "Démarrer ou redémarrer PilotPaper"
$Shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,137"
$Shortcut.Save()
Write-Host "[PilotPaper] Bouton créé sur le Bureau : PilotPaper"
