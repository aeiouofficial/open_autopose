@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20.19 or newer is required. Get it from https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules (
  echo(
  echo The local REST gateway is an optional advanced feature that needs a one-time
  echo dependency install with internet access:
  echo(
  echo     npm install
  echo(
  echo The offline app itself does NOT need this - use Start_App instead.
  pause
  exit /b 1
)
if "%TP_RENDER_MODE%"=="" set TP_RENDER_MODE=dryrun
call npm run gateway -- --host 127.0.0.1 --port 8787
