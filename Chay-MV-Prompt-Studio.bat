@echo off
chcp 65001 >nul
title MV Prompt Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Chua cai Node.js. Trinh duyet se mo trang tai Node.js - hay cai ban LTS roi chay lai file nay.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
node scripts\start.mjs
pause
