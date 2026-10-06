@echo off
setlocal
title VEREX - Revisar app de impresion
set "BASE=%USERPROFILE%\Desktop\SISTEMA VEREX OFICIAL MAY2026"
set "IMP=%BASE%\impresion"
echo.
echo  VEREX - Revisar la app de impresion
echo  -----------------------------------
call :chequear
if "%FALTA%"=="0" goto fin

echo.
echo  Faltan archivos. Intentando restaurarlos desde git...
pushd "%BASE%"
if exist ".git\index.lock" del /f /q ".git\index.lock"
git -c gc.auto=0 -c maintenance.auto=false checkout -- impresion/node_modules
popd
call :chequear
if "%FALTA%"=="0" goto fin

echo.
echo  Siguen faltando. Si existe "%IMP%\package.json", abre una ventana de comandos en esa carpeta y ejecuta:  npm install
echo  Si no, manda una captura de esta ventana.
goto fin2

:fin
echo.
echo  Todo esta en su lugar. Cierra la app de Impresion (bandeja, junto al reloj: clic derecho - Salir) y vuelve a abrirla.
:fin2
echo.
pause
exit /b 0

:chequear
set "FALTA=0"
call :ver "%IMP%\node_modules\pdfjs-dist\build\pdf.min.js"
call :ver "%IMP%\node_modules\pdfjs-dist\build\pdf.worker.min.js"
call :ver "%IMP%\node_modules\electron\dist\electron.exe"
call :ver "%IMP%\index.html"
call :ver "%IMP%\main.js"
exit /b 0

:ver
if exist "%~1" (
  echo  OK     %~1
) else (
  echo  FALTA  %~1
  set "FALTA=1"
)
exit /b 0
