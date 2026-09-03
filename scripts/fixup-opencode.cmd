@echo off
if not defined FIXUP_OPENCODE_PRIMARY_MODEL set "FIXUP_OPENCODE_PRIMARY_MODEL=opencode/muse-spark-1.2-contributor-free"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fixup-opencode-wrapper.ps1" %*
exit /b %ERRORLEVEL%
