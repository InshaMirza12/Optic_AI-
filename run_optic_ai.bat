@echo off
title Optic-AI Launcher
color 0B
echo ========================================================
echo               LAUNCHING OPTIC-AI SYSTEM
echo ========================================================
echo.
echo [1/2] Starting Optic-AI FastAPI Backend Server...
start "Optic-AI Backend Server (Port 8000)" cmd /k "cd /d E:\final_year_project && .\myenv\Scripts\python.exe main.py"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Optic-AI Expo Frontend Client...
start "Optic-AI Expo Client (Port 8081)" cmd /k "cd /d E:\final_year_project && npx expo start --web"

echo.
echo ========================================================
echo  Both servers have been launched in separate windows!
echo  - Web Browser: http://localhost:8081
echo  - Backend API: http://localhost:8000
echo ========================================================
pause
