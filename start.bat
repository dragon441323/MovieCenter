@echo off
chcp 65001 >nul
title MovieCenter 电影中心
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先从 https://nodejs.org 安装
  pause
  exit /b 1
)

if not exist "web\dist\index.html" (
  echo [moviecenter] 首次启动，正在构建前端界面（约 1 分钟，仅此一次）...
  call :npm_install web
  if errorlevel 1 goto fail
  pushd web
  call npm run build
  if errorlevel 1 (
    popd
    goto fail
  )
  popd
)

if not exist "server\node_modules" (
  echo [moviecenter] 安装服务端依赖...
  call :npm_install server
  if errorlevel 1 goto fail
)

where curl >nul 2>nul
if errorlevel 1 goto run
curl -s -m 2 http://localhost:9527/api/health 2>nul | find ":true" >nul 2>nul
if errorlevel 1 goto run
echo [moviecenter] 服务已在运行，直接打开 http://localhost:9527
start "" http://localhost:9527
ping -n 3 127.0.0.1 >nul
exit /b 0

:run
echo.
echo [moviecenter] 正在启动... 浏览器将自动打开 http://localhost:9527
echo [moviecenter] 关闭本窗口即可停止服务；局域网设备可用下方 LAN 地址访问
echo.
set MC_OPEN_BROWSER=1
pushd server
node src/index.js
popd
echo.
echo [moviecenter] 服务已停止
pause
exit /b 0

:fail
echo [错误] 启动失败，请检查上方提示
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
