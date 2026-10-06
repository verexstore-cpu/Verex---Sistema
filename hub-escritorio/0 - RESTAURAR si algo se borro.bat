@echo off
setlocal
title VEREX - Restaurar archivos
rem Deshace el ultimo "git reset --hard" hecho por la version anterior de RECIBIR CAMBIOS (que borraba node_modules y otras carpetas).
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
git -c gc.auto=0 -c maintenance.auto=false reset --hard ORIG_HEAD
if errorlevel 1 (
  echo.
  echo  No se pudo restaurar automaticamente. NO corras nada mas y mandame una captura de esta ventana.
) else (
  echo.
  echo  Listo: se restauro todo lo que estaba guardado en git ^(incluido impresion\node_modules^).
)
popd
echo.
pause
