@echo off
setlocal
title VEREX - Restaurar archivos
rem Cuando se cerro la ventana del reset anterior, git quedo a medias: borro archivos del disco pero NO llego a
rem actualizar su indice ni su historia. El indice sigue teniendo TODO lo viejo, asi que se vuelve a escribir en disco.
set "BASE=%USERPROFILE%\Desktop\SISTEMA VEREX OFICIAL MAY2026"
echo.
echo  VEREX - Restaurar archivos borrados
echo  -----------------------------------
if not exist "%BASE%\.git" (
  echo  NO se encontro la carpeta: %BASE%
  pause
  exit /b 1
)
pushd "%BASE%"
if exist ".git\index.lock" (
  echo  Quitando un bloqueo viejo de git...
  del /f /q ".git\index.lock"
)
echo.
echo  Archivos que faltaban antes de restaurar:
git -c gc.auto=0 -c maintenance.auto=false status --short | find /c " D "
echo.
echo  Restaurando...
git -c gc.auto=0 -c maintenance.auto=false checkout -- .
if errorlevel 1 (
  echo.
  echo  No se pudo restaurar. NO corras nada mas y mandame una captura de esta ventana.
) else (
  echo.
  echo  Archivos que faltan ahora ^(debe ser 0^):
  git -c gc.auto=0 -c maintenance.auto=false status --short | find /c " D "
  if exist "impresion\node_modules\electron" (echo  OK: impresion\node_modules\electron existe.) else (echo  AVISO: no aparece impresion\node_modules\electron - mandame captura.)
  echo.
  echo  Listo. Ahora puedes correr "RECIBIR CAMBIOS DE GITHUB.bat" ^(version segura^).
)
popd
echo.
pause
