@echo off
REM ASCII-only on purpose: .cmd files break on Cyrillic under the default codepage.
REM Double-click this file. It asks for admin rights and runs hiddify-diag.ps1.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

if not exist "%~dp0hiddify-diag.ps1" (
    echo ERROR: hiddify-diag.ps1 not found next to this file.
    echo Put both files in the same folder and try again.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0hiddify-diag.ps1'"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hiddify-diag.ps1"

echo.
echo Finished. The report is on your Desktop: hiddify-diag.txt
pause
