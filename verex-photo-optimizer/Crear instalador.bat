@echo off
setlocal
title VEREX PHOTO OPTIMIZER - Crear instalador
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Necesitas instalar Node.js ^(version LTS^) primero: https://nodejs.org
    echo Despues vuelve a hacer doble clic en este archivo.
    echo.
    pause
    exit /b 1
)

echo.
echo [1/3] Instalando dependencias ^(solo la primera vez, requiere internet^)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :error

echo.
echo [2/3] Probando el motor de imagen...
call npm test
if errorlevel 1 goto :error

echo.
echo [3/3] Creando el instalador .exe ...
call npm run dist
if errorlevel 1 goto :error

echo.
echo LISTO. El instalador esta en la carpeta "dist":
dir /b dist\*.exe
start "" "%~dp0dist"
pause
exit /b 0

:error
echo.
echo Algo fallo. Copia el mensaje de arriba y pasaselo a Claude.
pause
exit /b 1
