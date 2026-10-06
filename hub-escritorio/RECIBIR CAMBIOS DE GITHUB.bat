@echo off
setlocal EnableDelayedExpansion
title VEREX - Recibir cambios de GitHub
rem ------------------------------------------------------------------------------------------
rem Trae a ESTA PC lo que hay en GitHub (lo contrario de "Sincronizar Sistema", que SUBE lo de la PC).
rem Hace, en la carpeta principal y en _admin-repo, _consig-repo y _inventario-repo:
rem   1) guarda un respaldo de cualquier cambio local sin subir (git stash)
rem   2) descarta los commits locales atascados y deja el repo igual que GitHub
rem Despues copia verex_hub.py a "VEREX - Accesos Directos".
rem ------------------------------------------------------------------------------------------
set "BASE=%USERPROFILE%\Desktop\SISTEMA VEREX OFICIAL MAY2026"
echo.
echo  VEREX - Recibir cambios de GitHub
echo  ---------------------------------
if not exist "%BASE%\.git" (
  echo  NO se encontro la carpeta: %BASE%
  echo  Edita este archivo y corrige la ruta en la linea "set BASE=..."
  pause
  exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (
  echo  Git no esta instalado o no esta en el PATH.
  pause
  exit /b 1
)

call :actualizar "%BASE%"
for %%R in (_admin-repo _consig-repo _inventario-repo) do (
  if exist "%BASE%\%%R\.git" call :actualizar "%BASE%\%%R"
)

rem --- verex_hub.py (menu de VEREX HUB)
set "HUBDIR=%USERPROFILE%\Desktop\VEREX - Accesos Directos"
if exist "%BASE%\hub-escritorio\verex_hub.py" if exist "%HUBDIR%" (
  if exist "%HUBDIR%\verex_hub.py" copy /Y "%HUBDIR%\verex_hub.py" "%HUBDIR%\verex_hub_viejo.py" >nul
  copy /Y "%BASE%\hub-escritorio\verex_hub.py" "%HUBDIR%\verex_hub.py" >nul
  echo.
  echo  verex_hub.py actualizado en "VEREX - Accesos Directos" ^(copia del anterior: verex_hub_viejo.py^)
)

echo.
echo  LISTO. Ahora cierra VEREX HUB y la app de Impresion ^(bandeja, junto al reloj^) y vuelve a abrirlos.
echo  Importante: NO uses "Sincronizar Sistema" hasta haber hecho esto, porque sube lo de la PC sobre GitHub.
echo.
pause
exit /b 0

:actualizar
pushd "%~1" >nul
echo.
echo  === %~1
git stash push -m "respaldo antes de recibir cambios de GitHub" >nul 2>&1
git fetch origin
if errorlevel 1 (
  echo  ^(!^) No se pudo conectar con GitHub en esta carpeta.
  popd >nul
  exit /b 1
)
git remote set-head origin -a >nul 2>&1
set "RAMA="
for /f "delims=" %%H in ('git symbolic-ref --short refs/remotes/origin/HEAD 2^>nul') do set "RAMA=%%H"
if not defined RAMA (
  echo  ^(!^) No se pudo saber la rama principal.
  popd >nul
  exit /b 1
)
git reset --hard !RAMA!
popd >nul
exit /b 0
