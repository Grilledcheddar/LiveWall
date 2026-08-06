@echo off
setlocal
cd /d "%~dp0.."
call npm.cmd start 1>>"%~dp0..\data\launcher\server.log" 2>>"%~dp0..\data\launcher\server-error.log"
exit /b %errorlevel%
