@echo off
echo ============================================
echo   Env Guardian Server - First Time Setup
echo ============================================
echo.

echo [1/3] Checking Node.js...
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found.
    echo Please download from: https://nodejs.org/  (LTS version)
    pause
    exit /b 1
)
echo [OK] Node.js found.

echo.
echo [2/3] Installing dependencies...
npm install
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.

echo.
echo [3/3] Setup complete!
echo ============================================
echo   Now edit the .env file with your postgres
echo   password, then run START_SERVER.bat
echo ============================================
pause
