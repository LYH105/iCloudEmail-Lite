@echo off
setlocal
title iCloud Email Manager

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

call npm run desktop
if errorlevel 1 (
  echo.
  echo iCloud Email Manager startup failed. Error code: %errorlevel%
  pause
)

endlocal
