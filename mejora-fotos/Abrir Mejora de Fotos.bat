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

if not exist "node_modules" (
    echo Preparando la app por primera vez, un momento...
    call npm install
    if errorlevel 1 (
        echo.
        echo Hubo un error instalando. Revisa el mensaje de arriba.
        echo.
        pause
        exit /b 1
    )
)

start "" "node_modules\.bin\electron.cmd" .
