@echo off
rem Isumoa PC edition installer. No administrator rights needed.
rem The release script copies this file to the package root as the Korean-named install .bat.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\install.ps1"
if errorlevel 1 (
  echo.
  echo Install did not finish. Please read the message window, or the PC install guide.
  pause
)
