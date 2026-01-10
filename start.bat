@echo off
title Discord OnlyFans Bot
cd /d "%~dp0"
color 0A

:START
cls
echo.
echo ========================================
echo   Discord OnlyFans Bot
echo ========================================
echo.

REM Check Node.js
echo [1/3] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ERROR: Node.js not installed!
    echo       Download from: https://nodejs.org/
    goto END
)
echo       OK

REM Check npm
echo [2/3] Checking npm...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ERROR: npm not installed!
    goto END
)
echo       OK

REM Check node_modules
echo [3/3] Checking dependencies...
if not exist "node_modules\" (
    echo       MISSING - Installing now...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo       ERROR: npm install failed
        goto END
    )
)
echo       OK
echo.

REM Check if setup needed
if not exist "config\accounts.json" (
    echo First time setup required...
    echo.
    node setup.js
    if %ERRORLEVEL% NEQ 0 (
        echo Setup failed!
        goto END
    )
    echo.
)

REM Start bot
echo ========================================
echo   Ready to Start
echo ========================================
echo.
echo Press Enter to start the bot...
pause >nul
echo.
echo Starting bot...
echo.

node launcher.js
set BOT_EXIT=%ERRORLEVEL%

echo.
echo ========================================
if %BOT_EXIT% EQU 0 (
    echo   Bot stopped normally
) else (
    echo   Bot exited with error: %BOT_EXIT%
)
echo ========================================
echo.

REM Retry menu
echo What would you like to do?
echo [1] Restart bot
echo [2] Exit
echo.
choice /C 12 /N /M "Enter choice: "
if %ERRORLEVEL% EQU 1 goto START
if %ERRORLEVEL% EQU 2 goto END

:END
echo.
echo Press any key to exit...
pause >nul
