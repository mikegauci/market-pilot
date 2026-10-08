@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "setup\bootstrap-win.ps1"
echo.
pause
