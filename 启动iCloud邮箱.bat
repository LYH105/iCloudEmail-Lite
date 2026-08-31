@echo off
setlocal
chcp 65001 >nul
title iCloud Email Manager

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 22.12 或更高版本：https://nodejs.org/
  echo Node.js was not found. Install Node.js 22.12 or newer: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm，请重新安装 Node.js。
  echo npm was not found. Reinstall Node.js.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a^>22^|^|(a===22^&^&b^>=12)?0:1)"
if errorlevel 1 (
  echo 当前 Node.js 版本不受支持，项目要求 22.12 或更高版本。
  echo This Node.js version is unsupported; version 22.12 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\electron.cmd" (
  echo 尚未安装项目依赖。请先在此目录运行：npm install
  echo Dependencies are missing. Run this first: npm install
  pause
  exit /b 1
)

call npm run doctor
if errorlevel 1 (
  echo 环境检查未通过，请按上方提示修复后重试。
  pause
  exit /b 1
)

call npm run desktop
set "result=%errorlevel%"
if not "%result%"=="0" (
  echo.
  echo iCloud Email Manager startup failed. Error code: %result%
  pause
)

endlocal & exit /b %result%
