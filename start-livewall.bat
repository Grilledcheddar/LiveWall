@echo off
setlocal
cd /d "%~dp0"
title LiveWall Launcher

where powershell.exe >nul 2>nul || (
  echo Windows PowerShell is required to launch LiveWall.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-livewall.ps1"
if errorlevel 1 (
  echo.
  echo LiveWall could not start. Review the message above, then try again.
  pause
  exit /b 1
)

exit /b 0
