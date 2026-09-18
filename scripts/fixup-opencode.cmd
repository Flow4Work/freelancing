@echo off
if not defined FIXUP_OPENCODE_PRIMARY_MODEL set "FIXUP_OPENCODE_PRIMARY_MODEL=opencode/muse-spark-1.2-contributor-free"
if not defined FIXUP_OPENCODE_CHROME_PROFILE set "FIXUP_OPENCODE_CHROME_PROFILE=Profile 3"
if not defined FIXUP_OPENCODE_CHROME_PATH set "FIXUP_OPENCODE_CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%FIXUP_OPENCODE_CHROME_PATH%" exit /b 176
set "PLAYWRIGHT_MCP_EXECUTABLE_PATH=%FIXUP_OPENCODE_CHROME_PATH%"
set "PWTEST_EXTENSION_USER_DATA_DIR=%LOCALAPPDATA%\Google\Chrome\User Data"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fixup-opencode-wrapper.ps1" %*
exit /b %ERRORLEVEL%
