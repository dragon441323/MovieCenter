@echo off
chcp 65001 >nul
title MovieCenter 构建前端
cd /d "%~dp0"
call :npm_install web
if errorlevel 1 goto fail
pushd web
call npm run build
if errorlevel 1 (
  popd
  goto fail
)
popd
echo [moviecenter] 前端构建完成
pause
exit /b 0

:fail
echo [错误] 构建失败
pause
exit /b 1

:npm_install
if exist "%~1\node_modules" exit /b 0
pushd %~1
call npm install --no-fund --no-audit
if errorlevel 1 (
  popd
  exit /b 1
)
popd
exit /b 0
