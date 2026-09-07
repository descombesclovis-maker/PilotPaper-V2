@echo off
setlocal
cd /d "%~dp0"
title PilotPaper DP-AI-FIRST v0.4.3

echo ============================================================
echo   PilotPaper DP-AI-FIRST v0.4.3
echo ============================================================
if exist "%~dp0local-ai\" (
  echo [ERREUR] Ancien moteur local-ai detecte. Cette copie a ete fusionnee avec une ancienne version.
  echo Reinstallez PilotPaper v0.4.3 dans un dossier neuf.
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-pilotpaper.ps1"
if errorlevel 1 (
  echo.
  echo [PilotPaper] Le demarrage a echoue. Copiez le dernier message d'erreur sans jamais copier vos cles.
  pause
  exit /b 1
)
