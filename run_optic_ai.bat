@echo off
title Optic-AI Launcher
color 0B
echo ========================================================
echo               LAUNCHING OPTIC-AI SYSTEM
echo ========================================================
echo.
echo [Pre-check] Checking for existing processes on ports 8000 and 8081...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [Notice] Releasing occupied port 8000 (Process ID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8081 ^| findstr LISTENING 2^>nul') do (
    echo [Notice] Releasing occupied port 8081 (Process ID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo.
echo [1/2] Starting Optic-AI FastAPI Backend Server (Port 8000)...
start "Optic-AI Backend Server (Port 8000)" cmd /k "cd /d E:\final_year_project && .\myenv\Scripts\python.exe main.py"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Optic-AI Expo Frontend Client (Port 8081)...
start "Optic-AI Expo Client (Port 8081)" cmd /k "cd /d E:\final_year_project && npx expo start --web"

echo.
echo ========================================================
echo  Optic-AI System is running!
echo  - Web Application: http://localhost:8081
echo  - Voice AI Backend: http://localhost:8000
echo ========================================================
echo Keep these windows open while using Optic AI.
pause
