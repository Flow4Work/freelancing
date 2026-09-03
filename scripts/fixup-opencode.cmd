@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fixup-opencode-wrapper.ps1" %*
exit /b %ERRORLEVEL%
