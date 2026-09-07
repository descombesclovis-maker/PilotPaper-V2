@echo off
setlocal
cd /d "%~dp0"
title Installation PilotPaper DP-AI-FIRST v0.4.3

echo ============================================================
echo   PilotPaper DP-AI-FIRST v0.4.3
echo   Nouveau moteur integre - OpenAI uniquement
echo ============================================================
echo.

REM Refuse a directory that still contains legacy engine remnants.
if exist "%~dp0local-ai\" goto :legacy
if exist "%~dp0scripts\install-local-ai.ps1" goto :legacy
if exist "%~dp0scripts\start-local-ai.ps1" goto :legacy
if exist "%~dp0scripts\configure-premium.ps1" goto :legacy

echo [PilotPaper] Verification de la version...
if not exist "%~dp0PILOTPAPER-VERSION.txt" goto :badversion
findstr /C:"DP-AI-FIRST v0.4.3" "%~dp0PILOTPAPER-VERSION.txt" >nul || goto :badversion

echo [PilotPaper] Installation des composants web...
call npm.cmd install
if errorlevel 1 goto :error

echo [PilotPaper] Configuration de la cle OpenAI du nouveau moteur DP...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-openai.ps1"
if errorlevel 1 goto :error

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-desktop-shortcut.ps1"
if errorlevel 1 goto :error

echo.
echo [PilotPaper] Installation DP-AI-FIRST v0.4.3 terminee.
echo [PilotPaper] Aucun moteur Ollama/Python/local-ai n'est utilise.
pause
exit /b 0

:legacy
echo.
echo [ERREUR] Des fichiers de l'ancien moteur PilotPaper ont ete detectes dans ce dossier.
echo.
echo N'installez PAS la nouvelle version par-dessus C:\Projets\PilotPaper.
echo 1. Fermez PilotPaper et VS Code.
echo 2. Renommez l'ancien dossier PilotPaper en PilotPaper-ANCIEN.
echo 3. Decompressez le ZIP v0.4.3 dans un NOUVEAU dossier PilotPaper.
echo 4. Relancez INSTALLER-PILOTPAPER.cmd depuis ce nouveau dossier.
echo.
pause
exit /b 2

:badversion
echo.
echo [ERREUR] Cette copie n'est pas le package PilotPaper DP-AI-FIRST v0.4.3 complet.
echo Retirez-la et decompressez de nouveau le ZIP fourni par ChatGPT.
pause
exit /b 3

:error
echo.
echo [PilotPaper] Installation interrompue. Copiez le dernier message d'erreur sans jamais copier votre cle.
pause
exit /b 1
