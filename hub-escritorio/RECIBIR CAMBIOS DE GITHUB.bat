@echo off
setlocal EnableDelayedExpansion
title VEREX - Recibir cambios de GitHub (seguro)
rem ------------------------------------------------------------------------------------------
rem Trae a ESTA PC lo que hay en GitHub (lo contrario de "Sincronizar Sistema", que SUBE lo de la PC).
rem VERSION SEGURA: NO BORRA NINGUN ARCHIVO. Solo pone encima los archivos de GitHub.
rem  - node_modules, catalogo, .wrangler y demas carpetas que solo existen en tu PC se quedan intactas.
rem  - Tus cambios locales sin subir se guardan antes en un respaldo (git stash).
rem ------------------------------------------------------------------------------------------
set "BASE=%USERPROFILE%\Desktop\SISTEMA VEREX OFICIAL MAY2026"
echo.
echo  VEREX - Recibir cambios de GitHub  ^(version segura: no borra archivos^)
echo  -----------------------------------------------------------------------
if not exist "%BASE%\.git" (
  echo  NO se encontro la carpeta: %BASE%
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
echo  LISTO. Cierra VEREX HUB y la app de Impresion ^(bandeja, junto al reloj^) y vuelve a abrirlos.
echo  Importante: NO uses "Sincronizar Sistema" hasta que yo te lo indique.
echo.
pause
exit /b 0

:actualizar
pushd "%~1" >nul
echo.
echo  === %~1
set "GITQ=git -c gc.auto=0 -c maintenance.auto=false"
rem Las carpetas pesadas que solo viven en esta PC no deben subirse nunca (solo en este equipo, no toca GitHub)
if exist ".git\info" (
  for %%X in (node_modules/ .wrangler/ __pycache__/) do (
    findstr /x /c:"%%X" ".git\info\exclude" >nul 2>&1 || echo %%X>>".git\info\exclude"
  )
)
!GITQ! stash push -m "respaldo antes de recibir cambios de GitHub" >nul 2>&1
!GITQ! fetch origin
if errorlevel 1 (
  echo  ^(!^) No se pudo conectar con GitHub en esta carpeta.
  popd >nul
  exit /b 1
)
!GITQ! remote set-head origin -a >nul 2>&1
set "RAMA="
for /f "delims=" %%H in ('git symbolic-ref --short refs/remotes/origin/HEAD 2^>nul') do set "RAMA=%%H"
if not defined RAMA (
  echo  ^(!^) No se pudo saber la rama principal.
  popd >nul
  exit /b 1
)
rem 1) mueve SOLO la historia a GitHub (no toca tus archivos)   2) pone los archivos de GitHub encima (no borra nada)
!GITQ! reset --mixed !RAMA! >nul
!GITQ! checkout -- .
echo  OK: esta carpeta quedo igual que GitHub ^(!RAMA!^), sin borrar nada.
popd >nul
exit /b 0
