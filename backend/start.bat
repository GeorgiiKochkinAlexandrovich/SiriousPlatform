@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Stopping old Node process on port 3000 (if any)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting Sirius backend...
node server.js
pause
