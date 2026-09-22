@echo off
curl -s -m 2 http://localhost:9527/api/health 2>nul | find ":true" >nul 2>nul
if not errorlevel 1 exit /b 0
cd /d "%~dp0server"
node src/index.js
