@echo off
setlocal
title VEREX - Abrir Impresion sin administrador
rem Se vuelve a abrir a si mismo como administrador UNA vez (pide permiso) solo para poder cerrar la app elevada;
rem despues la vuelve a abrir como usuario NORMAL (a traves del Explorador), que es lo que permite arrastrar PDF.
net session >nul 2>&1
if errorlevel 1 (
  echo  Pidiendo permiso para cerrar la app elevada...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "BASE=%USERPROFILE%\Desktop\SISTEMA VEREX OFICIAL MAY2026"
echo.
echo  VEREX - Abrir Impresion SIN administrador
echo  -----------------------------------------
echo  1) Cerrando la app de impresion que esta elevada...
taskkill /F /IM electron.exe >nul 2>&1
echo  2) Quitando la marca "Ejecutar como administrador" guardada...
powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE%\impresion\quitar_admin.ps1"
timeout /t 2 /nobreak >nul
echo  3) Abriendo la app como usuario normal...
explorer.exe "%BASE%\impresion\Abrir Guias VEREX.vbs"
echo.
echo  Listo. Espera unos segundos a que abra la app y arrastra el PDF a "Cualquier PDF".
echo  Si VEREX HUB tambien estaba como administrador, cierralo y abrelo con doble clic normal.
echo.
pause
