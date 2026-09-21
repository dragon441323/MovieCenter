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

:: 计算当前磁盘代码的版本指纹（server\src 下最新 .js 的修改时间，Unix 秒）
set "LOCAL_STAMP="
for /f "delims=" %%T in ('powershell -NoProfile -Command "$s=0; Get-ChildItem -Recurse -Filter *.js -File 'server\src' | ForEach-Object { if ($_.LastWriteTimeUtc.Ticks -gt $s) { $s=$_.LastWriteTimeUtc.Ticks } }; [math]::Floor(($s - 621355968000000000) / 10000000)" 2^>nul') do set "LOCAL_STAMP=%%T"

:: 服务是否已在运行
curl -s -m 2 http://localhost:9527/api/health 2>nul > "%TEMP%\mc-health.tmp"
findstr /C:"true" "%TEMP%\mc-health.tmp" >nul 2>nul
if errorlevel 1 goto run

:: 运行中的服务与磁盘代码是否一致
set "RUNNING_STAMP="
if defined LOCAL_STAMP (
  for /f "delims=" %%V in ('curl -s -m 2 "http://localhost:9527/api/version?plain=1" 2^>nul') do set "RUNNING_STAMP=%%V"
)

if not defined LOCAL_STAMP goto open_only
if not defined RUNNING_STAMP goto open_only
if "%LOCAL_STAMP%"=="%RUNNING_STAMP%" goto open_only

:: 代码已更新：杀掉旧进程换新版本
echo [moviecenter] 检测到代码已更新（运行中 %RUNNING_STAMP% - 最新 %LOCAL_STAMP%），正在重启服务...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":9527 .*LISTENING"') do taskkill /PID %%P /F >nul 2>nul
ping -n 2 127.0.0.1 >nul
goto run

:open_only
echo [moviecenter] 服务已在运行且为最新代码，直接打开 http://localhost:9527
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
