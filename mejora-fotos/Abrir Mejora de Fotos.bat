@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo No se encontro Node.js instalado en esta PC.
    echo Descargalo de https://nodejs.org ^(version LTS^), instalalo,
    echo y despues volve a abrir este acceso directo.
    echo.
    pause
    exit /b 1
)

rem Mirror alternativo para el .exe de Electron -- si la descarga desde
rem GitHub esta bloqueada (firewall/antivirus/red corporativa), esto usa
rem un origen distinto sin que haga falta tocar nada a mano.
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

if not exist "node_modules" (
    echo Preparando la app por primera vez, un momento...
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
    echo Revisa el antivirus (que no haya puesto en cuarentena nada de
    echo esta carpeta) y volve a abrir este acceso directo.
    echo.
    pause
    exit /b 1
)

start "" "node_modules\.bin\electron.cmd" .
