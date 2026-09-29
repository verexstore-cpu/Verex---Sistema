@echo off
setlocal
title VEREX PHOTO OPTIMIZER
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Necesitas instalar Node.js ^(version LTS^) primero: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\electron" (
    echo Instalando dependencias ^(solo la primera vez, requiere internet^)...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo No se pudo instalar. Revisa tu conexion e intenta de nuevo.
        pause
        exit /b 1
    )
)

start "" /b cmd /c "npm start"
exit /b 0
