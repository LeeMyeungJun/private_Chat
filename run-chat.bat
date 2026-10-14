@echo off
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 이상을 설치한 후 다시 실행해 주세요.
  pause
  exit /b 1
)
if not exist node_modules\electron\dist\electron.exe (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node -e "require('electron')"
if errorlevel 1 (
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-chat.ps1"
if errorlevel 1 pause
