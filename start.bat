@echo off
setlocal enabledelayedexpansion
title Discord OnlyFans Bot
cd /d "%~dp0"

REM Check if directory change worked
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Could not navigate to bot directory!
    echo.
    pause
    exit /b 1
)

color 0A

REM Check if bot is already running
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I "node.exe" >NUL
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   Bot is already running!
    echo ========================================
    echo.
    echo Double-click start.bat again to continue
    echo or close this window
    echo.
    pause
    exit /b
)

:MAIN_START
cls
echo.
echo ========================================
echo   Discord OnlyFans Bot v4.5
echo   Production Ready
echo ========================================
echo.
echo Initializing setup...
echo.

echo [1/3] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       NOT FOUND - Node.js is required
    echo.
    set /p INSTALL_NODE="       Auto-download and install Node.js? (Press Enter to continue, Ctrl+C to cancel): "
    
    echo.
    echo       Downloading Node.js LTS...
    echo.
    
    REM Download Node.js using PowerShell (simplified single line)
    powershell -NoProfile -ExecutionPolicy Bypass "$url='https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi'; $out=[System.IO.Path]::GetTempPath()+'node.msi'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; (New-Object System.Net.WebClient).DownloadFile($url,$out); Start-Process $out -ArgumentList '/quiet /norestart' -Wait; Remove-Item $out -Force -ErrorAction SilentlyContinue" 2>nul
    
    if %ERRORLEVEL% NEQ 0 (
        echo       ERROR: Failed to download/install Node.js
        echo       Manual download: https://nodejs.org/
        echo.
        pause
        goto END
    )
    
    echo       [OK] Node.js installed successfully!
    echo.
    timeout /t 2 /nobreak >nul
    goto MAIN_START
)
echo       [OK] Node.js is installed
echo.

echo [2/3] Checking npm...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ERROR: npm not installed!
    echo.
    pause
    goto END
)
echo       [OK] npm is installed
echo.

echo [3/3] Checking dependencies...
if not exist "node_modules\" (
    echo       MISSING - Installing now...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo       ERROR: npm install failed
        echo.
        pause
        goto END
    )
    echo       [OK] Dependencies installed
) else (
    echo       [OK] Dependencies already installed
)
echo.

echo ========================================
echo   All dependencies confirmed!
echo ========================================
echo.
pause

if not exist ".env" (
    echo.
    echo [ERROR] No Discord account found!
    echo.
    pause
    goto SETUP_NEW_ACCOUNT
) else (
    echo.
    echo [OK] Discord account found
    echo.
    pause
    goto MAIN_MENU
)

:SETUP_NEW_ACCOUNT
cls
echo.
echo ========================================
echo   Add First Discord Account
echo ========================================
echo.
set /p USERNAME="Enter Discord Username: "
set /p EMAIL="Enter Discord Email: "
set /p PASSWORD="Enter Discord Password: "
set /p OF_LINK="Enter OnlyFans Link: "

REM Save to accounts.json database (direct array format)
node -e "
const fs = require('fs');
const accounts = [{ 
  username: '!USERNAME!', 
  email: '!EMAIL!', 
  password: '!PASSWORD!', 
  ofLink: '!OF_LINK!' 
}];
fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
"

REM Create .env with this account
(
echo DISCORD_EMAIL=!EMAIL!
echo DISCORD_PASSWORD=!PASSWORD!
echo BOT_USERNAME=!USERNAME!
echo OF_LINK=!OF_LINK!
echo GEMINI_API_KEY_1=
echo GEMINI_API_KEY_2=
echo GEMINI_API_KEY_3=
echo OPENAI_API_KEY=
echo CHECK_DMS_INTERVAL=5000
echo RESPONSE_DELAY_MIN=1000
echo RESPONSE_DELAY_MAX=3000
) > .env

echo.
echo [OK] Discord account saved!
echo.
pause
goto MAIN_MENU

:MAIN_MENU
cls
echo.
echo ========================================
echo   Main Menu
echo ========================================
echo.
echo [1] Configure Discord Account
echo [2] Change OF_LINK
echo [3] Select Profile
echo [4] Start Bot
echo [5] Reset Bot (clear data/accounts/logs)
echo [6] Delete Everything (IRREVERSIBLE)
echo [7] Exit
echo.
set /p choice="Enter choice (1-7): "

if "%choice%"=="1" goto CONFIGURE_ACCOUNT
if "%choice%"=="2" goto CHANGE_OF_LINK
if "%choice%"=="3" goto SELECT_PROFILE
if "%choice%"=="4" goto START_BOT
if "%choice%"=="5" goto RESET_BOT
if "%choice%"=="6" goto DELETE_EVERYTHING
if "%choice%"=="7" goto END
echo Invalid choice. Try again.
pause
goto MAIN_MENU

:CONFIGURE_ACCOUNT
cls
echo.
echo ========================================
echo   Configure Discord Account
echo ========================================
echo.
echo [1] View Current Account
echo [2] View All Accounts
echo [3] Add New Account
echo [4] Back
echo.
set /p choice="Enter choice (1-4): "

if "%choice%"=="1" goto VIEW_CURRENT
if "%choice%"=="2" goto LIST_ACCOUNTS
if "%choice%"=="3" goto ADD_NEW_ACCOUNT
if "%choice%"=="4" goto MAIN_MENU
echo Invalid choice. Try again.
pause
goto CONFIGURE_ACCOUNT

:VIEW_CURRENT
cls
echo.
echo ========================================
echo   View Current Account
echo ========================================
echo.
for /f "tokens=2 delims==" %%a in ('type .env ^| find "DISCORD_EMAIL"') do set EMAIL=%%a
for /f "tokens=2 delims==" %%a in ('type .env ^| find "BOT_USERNAME"') do set USERNAME=%%a

if "!USERNAME!"=="" set USERNAME=Not set

echo Email:    %EMAIL%
echo Username: %USERNAME%
echo.
echo [1] Edit This Account
echo [2] Back
echo.
set /p choice="Enter choice (1-2): "

if "%choice%"=="1" goto EDIT_CURRENT
if "%choice%"=="2" goto CONFIGURE_ACCOUNT
echo Invalid choice. Try again.
pause
goto VIEW_CURRENT

:EDIT_CURRENT
cls
echo.
echo ========================================
echo   Edit Current Account
echo ========================================
echo.
echo [1] Change Email
echo [2] Change Username
echo [3] Change Password
echo [4] Back
echo.
set /p choice="Enter choice (1-4): "

REM Check Back first before any blocks
if "%choice%"=="4" (
    goto VIEW_CURRENT
)

REM Email Edit
if "%choice%"=="1" (
    set /p NEWEMAIL="Enter new Email: "
    node -e "
    const fs = require('fs');
    try {
        const data = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'));
        const accounts = Array.isArray(data) ? data : (data.accounts || []);
        const envContent = fs.readFileSync('.env', 'utf8');
        const currentEmailMatch = envContent.match(/DISCORD_EMAIL=(.+)/);
        const currentEmail = currentEmailMatch ? currentEmailMatch[1].trim() : null;
        
        if (currentEmail) {
            const idx = accounts.findIndex(a => a.email === currentEmail);
            if (idx !== -1) {
                accounts[idx].email = '!NEWEMAIL!';
                fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
            }
        }
        
        const newEnv = envContent.replace(/DISCORD_EMAIL=.*/m, 'DISCORD_EMAIL=!NEWEMAIL!');
        fs.writeFileSync('.env', newEnv);
        console.log('[OK] Email updated!');
    } catch (e) {
        console.error('[ERROR]', e.message);
    }
    "
    pause
    goto EDIT_CURRENT
)

REM Username Edit
if "%choice%"=="2" (
    set /p NEWUSERNAME="Enter new Username: "
    node -e "
    const fs = require('fs');
    try {
        const data = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'));
        const accounts = Array.isArray(data) ? data : (data.accounts || []);
        const envContent = fs.readFileSync('.env', 'utf8');
        const currentEmailMatch = envContent.match(/DISCORD_EMAIL=(.+)/);
        const currentEmail = currentEmailMatch ? currentEmailMatch[1].trim() : null;
        
        if (currentEmail) {
            const idx = accounts.findIndex(a => a.email === currentEmail);
            if (idx !== -1) {
                accounts[idx].username = '!NEWUSERNAME!';
                fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
            }
        }
        
        const newEnv = envContent.replace(/BOT_USERNAME=.*/m, 'BOT_USERNAME=!NEWUSERNAME!');
        fs.writeFileSync('.env', newEnv);
        console.log('[OK] Username updated!');
    } catch (e) {
        console.error('[ERROR]', e.message);
    }
    "
    pause
    goto EDIT_CURRENT
)

REM Password Edit
if "%choice%"=="3" (
    set /p NEWPASSWORD="Enter new Password: "
    node -e "
    const fs = require('fs');
    try {
        const data = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'));
        const accounts = Array.isArray(data) ? data : (data.accounts || []);
        const envContent = fs.readFileSync('.env', 'utf8');
        const currentEmailMatch = envContent.match(/DISCORD_EMAIL=(.+)/);
        const currentEmail = currentEmailMatch ? currentEmailMatch[1].trim() : null;
        
        if (currentEmail) {
            const idx = accounts.findIndex(a => a.email === currentEmail);
            if (idx !== -1) {
                accounts[idx].password = '!NEWPASSWORD!';
                fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
            }
        }
        
        const newEnv = envContent.replace(/DISCORD_PASSWORD=.*/m, 'DISCORD_PASSWORD=!NEWPASSWORD!');
        fs.writeFileSync('.env', newEnv);
        console.log('[OK] Password updated!');
    } catch (e) {
        console.error('[ERROR]', e.message);
    }
    "
    pause
    goto EDIT_CURRENT
)

REM Invalid choice
echo Invalid choice. Try again.
pause
goto EDIT_CURRENT

:ADD_NEW_ACCOUNT
cls
echo.
echo ========================================
echo   Add New Discord Account
echo ========================================
echo.
set /p USERNAME="Enter Discord Username: "
set /p EMAIL="Enter Discord Email: "
set /p PASSWORD="Enter Discord Password: "
set /p OF_LINK="Enter OnlyFans Link: "

node -e "
const fs = require('fs');
try {
    let accounts = [];
    if (fs.existsSync('config/accounts.json')) {
        const data = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'));
        accounts = Array.isArray(data) ? data : (data.accounts || []);
    }
    accounts.push({ 
        username: '!USERNAME!', 
        email: '!EMAIL!', 
        password: '!PASSWORD!', 
        ofLink: '!OF_LINK!' 
    });
    fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
    console.log('[OK] Account added to database!');
} catch (e) {
    console.error('[ERROR]', e.message);
}
"

echo.
pause
goto CONFIGURE_ACCOUNT

:LIST_ACCOUNTS
cls
echo.
echo ========================================
echo   Select Discord Account
echo ========================================
echo.

node -e "const fs = require('fs'); if (fs.existsSync('config/accounts.json')) { try { const a = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8')); const accounts = Array.isArray(a) ? a : (a.accounts || []); if (accounts && accounts.length > 0) { accounts.forEach((acc, i) => console.log('[' + (i+1) + '] ' + (acc.username || 'Unknown') + ' (' + (acc.email || 'No email') + ')')); } else { console.log('No accounts saved'); } } catch(e) { console.log('Error:', e.message); } } else { console.log('No accounts database found'); }"

echo.
echo [0] Back to Account Configuration
echo.
set /p choice="Enter account number or 0 to go back: "

if "%choice%"=="" goto LIST_ACCOUNTS
if "%choice%"=="0" goto CONFIGURE_ACCOUNT

node -e "const fs = require('fs'); const num = parseInt('!choice!'); if (num > 0 && fs.existsSync('config/accounts.json')) { try { const a = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8')); const accounts = Array.isArray(a) ? a : (a.accounts || []); const acc = accounts[num-1]; if (acc) { const env = 'DISCORD_EMAIL='+(acc.email||'')+'\nDISCORD_PASSWORD='+(acc.password||'')+'\nBOT_USERNAME='+(acc.username||'')+'\nOF_LINK='+(acc.ofLink||'')+'\nGEMINI_API_KEY_1=\nGEMINI_API_KEY_2=\nGEMINI_API_KEY_3=\nOPENAI_API_KEY=\nCHECK_DMS_INTERVAL=5000\nRESPONSE_DELAY_MIN=1000\nRESPONSE_DELAY_MAX=3000'; fs.writeFileSync('.env', env); console.log('[OK] Switched to: '+(acc.username||acc.email)); } else { console.log('[ERROR] Invalid account number'); } } catch(e) { console.log('[ERROR]', e.message); } } else { console.log('[ERROR] Invalid choice'); }"

echo.
pause
goto LIST_ACCOUNTS
:SELECT_PROFILE
cls
echo.
echo ========================================
echo   Profile Management
echo ========================================
echo.
echo [1] Select Profile
echo [2] Add New Profile
echo [3] Delete Profile
echo [4] Back to Main Menu
echo.
set /p CHOICE="Enter choice (1-4): "

if "%CHOICE%"=="1" goto SELECT_PROFILE_ID
if "%CHOICE%"=="2" goto ADD_NEW_PROFILE
if "%CHOICE%"=="3" goto DELETE_PROFILE_MENU
if "%CHOICE%"=="4" goto MAIN_MENU

echo Invalid choice. Try again.
pause
goto SELECT_PROFILE

:SELECT_PROFILE_ID
cls
echo.
echo ========================================
echo   Select Active Profile
echo ========================================
echo..

node scripts\profile-manager.js view
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to load profiles
    pause
    goto SELECT_PROFILE
)

echo.
set /p PROFILE_ID="Enter profile ID (or press Enter to go back): "

if "%PROFILE_ID%"=="" goto SELECT_PROFILE

node scripts\profile-manager.js setactive %PROFILE_ID%
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Profile activated successfully!
    echo.
    pause
    goto MAIN_MENU
) else (
    echo.
    echo [ERROR] Invalid profile ID
    echo.
    pause
    goto SELECT_PROFILE_ID
)

:ADD_NEW_PROFILE
cls
echo.
echo ========================================
echo       Add New Profile
echo ========================================
echo.
set /p PROF_NAME="Enter profile name: "
if "%PROF_NAME%"=="" goto SELECT_PROFILE

set /p PROF_AGE="Enter profile age: "
if "%PROF_AGE%"=="" goto SELECT_PROFILE

set /p PROF_LOCATION="Enter profile location: "
if "%PROF_LOCATION%"=="" goto SELECT_PROFILE

set /p PROF_RACE="Enter profile race/ethnicity: "
if "%PROF_RACE%"=="" goto SELECT_PROFILE

node scripts\profile-manager.js create "%PROF_NAME%" %PROF_AGE% "%PROF_LOCATION%" "%PROF_RACE%"
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Profile created successfully!
    echo.
    pause
    goto SELECT_PROFILE
) else (
    echo.
    echo [ERROR] Failed to create profile
    echo.
    pause
    goto ADD_NEW_PROFILE
)

:DELETE_PROFILE_MENU
cls
echo.
echo ========================================
echo       Delete Profile
echo ========================================
echo.

node scripts\profile-manager.js view
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to load profiles
    pause
    goto SELECT_PROFILE
)

echo.
set /p DELETE_ID="Enter profile ID to delete (or press Enter to cancel): "
if "%DELETE_ID%"=="" goto SELECT_PROFILE

echo.
echo Deleting profile ID %DELETE_ID%...
node scripts\profile-manager.js delete %DELETE_ID%
if %ERRORLEVEL% EQU 0 (
    echo.
    pause
    goto SELECT_PROFILE
) else (
    echo.
    echo [ERROR] Invalid profile ID
    echo.
    pause
    goto DELETE_PROFILE_MENU
)
:CHANGE_OF_LINK
cls
echo.
echo ========================================
echo   Change OnlyFans Link
echo ========================================
echo.
for /f "tokens=2 delims==" %%a in ('type .env ^| find "OF_LINK"') do echo Current OF_LINK: %%a
echo.
set /p NEW_OF_LINK="Enter new OF_LINK (or press Enter to cancel): "
if "%NEW_OF_LINK%"=="" goto MAIN_MENU

node -e "
const fs = require('fs');
try {
    const data = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'));
    const accounts = Array.isArray(data) ? data : (data.accounts || []);
    const envContent = fs.readFileSync('.env', 'utf8');
    const currentEmailMatch = envContent.match(/DISCORD_EMAIL=(.+)/);
    const currentEmail = currentEmailMatch ? currentEmailMatch[1].trim() : null;
    
    if (currentEmail) {
        const idx = accounts.findIndex(a => a.email === currentEmail);
        if (idx !== -1) {
            accounts[idx].ofLink = '!NEW_OF_LINK!';
            fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
        }
    }
    
    const newEnv = envContent.replace(/OF_LINK=.+/, 'OF_LINK=!NEW_OF_LINK!');
    fs.writeFileSync('.env', newEnv);
    console.log('[OK] OF_LINK updated!');
} catch (e) {
    console.error('[ERROR]', e.message);
}
"

echo.
pause
goto MAIN_MENU

:START_BOT
cls
echo.
echo ========================================
echo   Starting Bot
echo ========================================
echo.
echo Launching Discord OnlyFans Bot...
echo.

node bot.js
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

set /p choice="[1] Return to Menu [2] Exit: "
if "%choice%"=="1" goto MAIN_MENU
if "%choice%"=="2" goto END
echo Invalid choice. Try again.
pause
goto START_BOT

:RESET_BOT
cls
echo.
echo ========================================
echo   RESET BOT - CLEAR DATA
echo ========================================
echo.
echo WARNING: This will delete:
echo   - All saved accounts (config/accounts.json)
echo   - All saved data (data/ folder)
echo   - All logs (logs/ folder)
echo   - All cached information
echo.
echo The bot code will remain intact.
echo You will need to set up a fresh account after reset.
echo.
set /p confirm="Are you sure? (yes/no): "

if /i "%confirm%"=="yes" (
    echo.
    echo Type 'reset' exactly to confirm this action:
    set /p typereset=">>> "
    
    if "%typereset%"=="reset" (
        cls
        echo.
        echo ========================================
        echo   RESETTING BOT...
        echo ========================================
        echo.
        
        REM Stop any running node processes
        taskkill /FI "IMAGENAME eq node.exe" /F 2>NUL
        
        echo Clearing accounts database...
        if exist "config\accounts.json" del "config\accounts.json" 2>NUL
        
        echo Clearing saved data and cache...
        if exist "data\" rmdir /s /q "data\" 2>NUL
        
        echo Clearing logs...
        if exist "logs\" rmdir /s /q "logs\" 2>NUL
        
        echo Clearing bot state...
        if exist "bot-state.json" del "bot-state.json" 2>NUL
        
        echo Clearing Discord cookies...
        if exist "data\discord-cookies.json" del "data\discord-cookies.json" 2>NUL
        
        echo.
        echo ========================================
        echo   RESET COMPLETE
        echo ========================================
        echo.
        echo All data has been cleared.
        echo You can now set up a fresh account.
        echo.
        pause
        goto MAIN_MENU
    ) else (
        cls
        echo.
        echo ========================================
        echo   RESET CANCELLED
        echo ========================================
        echo.
        echo You did not type 'reset' correctly.
        echo Returning to main menu...
        echo.
        pause
        goto MAIN_MENU
    )
) else (
    cls
    echo.
    echo ========================================
    echo   RESET CANCELLED
    echo ========================================
    echo.
    echo Reset operation cancelled.
    echo.
    pause
    goto MAIN_MENU
)

:DELETE_EVERYTHING
cls
echo.
echo ========================================
echo   DELETE EVERYTHING - IRREVERSIBLE
echo ========================================
echo.
echo WARNING: This will permanently delete:
echo   - All bot configuration (.env)
echo   - All saved data (config/, data/)
echo   - All logs
echo   - All source code (src/, scripts/)
echo   - All node_modules
echo   - ALL OTHER FILES IN THIS FOLDER
echo.
echo This action CANNOT be undone!
echo.
set /p confirm="Are you sure? (yes/no): "

if /i "%confirm%"=="yes" (
    echo.
    echo Type 'delete' exactly to confirm permanent deletion:
    set /p typedelete=">>> "
    
    if "%typedelete%"=="delete" (
        cls
        echo.
        echo ========================================
        echo   DELETING ENTIRE SYSTEM...
        echo ========================================
        echo.
        
        REM Stop any running node processes
        taskkill /FI "IMAGENAME eq node.exe" /F 2>NUL
        
        REM Delete all critical folders
        echo Deleting configuration...
        if exist "config\" rmdir /s /q "config\" 2>NUL
        
        echo Deleting saved data...
        if exist "data\" rmdir /s /q "data\" 2>NUL
        
        echo Deleting logs...
        if exist "logs\" rmdir /s /q "logs\" 2>NUL
        
        echo Deleting source code...
        if exist "src\" rmdir /s /q "src\" 2>NUL
        if exist "scripts\" rmdir /s /q "scripts\" 2>NUL
        
        echo Deleting dependencies...
        if exist "node_modules\" rmdir /s /q "node_modules\" 2>NUL
        
        echo Deleting environment file...
        if exist ".env" del ".env" 2>NUL
        
        echo Deleting bot state...
        if exist "bot-state.json" del "bot-state.json" 2>NUL
        
        echo.
        echo ========================================
        echo   DELETION COMPLETE
        echo ========================================
        echo.
        echo All bot files have been permanently deleted.
        echo.
        echo You can re-run start.bat to set up a fresh bot.
        echo.
        pause
        goto MAIN_START
    ) else (
        cls
        echo.
        echo ========================================
        echo   DELETION CANCELLED
        echo ========================================
        echo.
        echo You did not type 'delete' correctly.
        echo Returning to main menu...
        echo.
        pause
        goto MAIN_MENU
    )
) else (
    cls
    echo.
    echo ========================================
    echo   DELETION CANCELLED
    echo ========================================
    echo.
    echo Delete operation cancelled.
    echo.
    pause
    goto MAIN_MENU
)

:END
echo.
echo Press any key to exit...
pause >nul
