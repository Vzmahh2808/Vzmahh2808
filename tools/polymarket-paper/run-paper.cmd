@echo off
REM ASCII-only on purpose: .cmd files break on Cyrillic under the default codepage.
REM Double-click to start paper trading (no real orders, no wallet needed).
REM Extra arguments are passed through, for example:
REM   run-paper.cmd live --assets btc,eth --minutes 240
REM   run-paper.cmd replay data\rec-20260923-120000.jsonl.gz --latency 500
REM   run-paper.cmd demo
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
    where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo Python not found. Install Python 3.10 or newer from https://www.python.org/downloads/
    echo During the install tick "Add python.exe to PATH", then run this file again.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo First run: creating .venv and installing dependencies, this takes a minute...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo ERROR: could not create the .venv folder.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 (
    echo ERROR: could not install dependencies. Check the internet connection.
    pause
    exit /b 1
)

if "%~1"=="" (
    ".venv\Scripts\python.exe" -m paper live
) else (
    ".venv\Scripts\python.exe" -m paper %*
)

echo.
pause
