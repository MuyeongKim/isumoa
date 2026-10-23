@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo Please run this file as Administrator.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-service.ps1"
pause
