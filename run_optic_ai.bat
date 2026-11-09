@echo off
title Optic-AI Launcher
color 0B

echo ========================================================
echo               LAUNCHING OPTIC-AI SYSTEM
echo ========================================================
echo.

cd /d E:\final_year_project

echo [1/3] Clearing any stuck processes on ports 8000 and 8081...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8081" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo.
echo [2/3] Starting Optic-AI FastAPI Backend Server (Port 8000)...
start "Optic-AI Backend Server (Port 8000)" cmd /k "cd /d E:\final_year_project && .\myenv\Scripts\python.exe main.py"

ping 127.0.0.1 -n 3 >nul

echo [3/3] Starting Optic-AI Expo Frontend Client (Port 8081)...
start "Optic-AI Expo Client (Port 8081)" cmd /k "cd /d E:\final_year_project && npx expo start --web"

echo.
echo ========================================================
echo  Optic-AI is running!
echo  - Web Application: http://localhost:8081
echo  - Voice Backend API: http://localhost:8000
echo ========================================================
echo Keep both terminal windows open while using Optic AI.
echo.
pause
