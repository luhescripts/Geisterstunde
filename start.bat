@echo off
title Geisterstunde
cd /d "%~dp0"

if not exist "server.js" (
  echo Dieses Skript muss im entpackten Geisterstunde-Ordner liegen.
  echo Bitte den ganzen Ordner kopieren bzw. die ZIP-Datei erst entpacken.
  pause
  exit /b 1
)

rem ---------- Node.js ----------
call :findnode
if defined NODE goto havenode
echo Node.js ist auf diesem PC nicht installiert.
choice /c JN /m "Jetzt per winget installieren"
if errorlevel 2 goto nonode
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
call :findnode
if defined NODE goto havenode
:nonode
echo.
echo Bitte Node.js (LTS) von https://nodejs.org installieren und start.bat erneut starten.
pause
exit /b 1

:havenode
if exist "node_modules\socket.io\package.json" goto depsok
echo Installiere Abhaengigkeiten ...
call "%NODEDIR%npm.cmd" install --no-audit --no-fund
if exist "node_modules\socket.io\package.json" goto depsok
echo.
echo Die Installation hat nicht geklappt. Besteht eine Internetverbindung?
pause
exit /b 1
:depsok

if exist "tunnel.log" del /q "tunnel.log" >nul 2>&1
start "Geisterstunde Server" cmd /k ""%NODE%" server.js"
timeout /t 2 /nobreak >nul

rem ---------- cloudflared (Online-Link) ----------
call :findcf
if defined CF goto havecf
echo.
echo cloudflared fuer den Online-Link ist auf diesem PC nicht installiert.
choice /c JN /m "Jetzt per winget installieren"
if errorlevel 2 goto nocf
winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
call :findcf
if defined CF goto havecf
:nocf
echo.
echo Ohne cloudflared laeuft das Spiel nur lokal bzw. im selben WLAN.
start "" "http://localhost:3666"
pause
exit /b 0

:havecf
start "Geisterstunde Tunnel" cmd /k ""%CF%" tunnel --no-autoupdate --logfile tunnel.log --url http://localhost:3666"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3666"
echo.
echo Der Browser oeffnet sich. Klicke auf "Neues Spiel hosten".
echo Sobald der Tunnel steht (meist nach wenigen Sekunden), zeigt die Lobby
echo automatisch den Online-Einladungslink fuer deine Freunde.
echo.
echo Die Fenster "Geisterstunde Server" und "Geisterstunde Tunnel" bitte offen lassen.
echo.
pause
exit /b 0

rem ---------- Hilfsroutinen ----------
:findnode
set "NODE="
set "NODEDIR="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE for %%d in ("%NODE%") do set "NODEDIR=%%~dpd"
exit /b 0

:findcf
set "CF="
for /f "delims=" %%i in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%i"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
exit /b 0
