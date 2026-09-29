@echo off
setlocal
title VEREX - Mejora de Fotos
set REPO_DIR=%USERPROFILE%\Desktop\VerexMejoraFotos

where git >nul 2>nul
if errorlevel 1 (
    echo.
    echo Necesitas instalar Git primero.
    echo Descargalo de https://git-scm.com/download/win ^(todo "Siguiente" con lo que viene por defecto^),
    echo instalalo, y despues volve a hacer doble clic en este archivo.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Necesitas instalar Node.js primero.
    echo Descargalo de https://nodejs.org ^(version LTS^), instalalo,
    echo y despues volve a hacer doble clic en este archivo.
    echo.
    pause
    exit /b 1
)

if not exist "%REPO_DIR%" (
    echo Preparando todo por primera vez, un momento...
    git clone --quiet https://github.com/verexstore-cpu/Verex---Sistema.git "%REPO_DIR%"
) else (
    echo Buscando actualizaciones...
    cd /d "%REPO_DIR%"
    git pull --quiet
)

cd /d "%REPO_DIR%\mejora-fotos"

rem Mirror alternativo para el .exe de Electron -- si la descarga desde
rem GitHub esta bloqueada (firewall/antivirus/red corporativa), esto usa
rem un origen distinto sin que haga falta tocar nada a mano.
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

if not exist "node_modules" (
    echo Preparando la app, un momento...
    call npm install
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Reparando la instalacion de Electron, un momento...
    rmdir /s /q "node_modules\electron" >nul 2>nul
    rmdir /s /q "%LOCALAPPDATA%\electron\Cache" >nul 2>nul
    call npm install
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo No se pudo instalar Electron automaticamente en esta PC.
    echo Puede que un antivirus o firewall este bloqueando la descarga.
    echo Revisa el antivirus y volve a hacer doble clic en este archivo.
    echo.
    pause
    exit /b 1
)

start "" "node_modules\.bin\electron.cmd" .
