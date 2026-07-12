@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20.19 or newer is required. Get it from https://nodejs.org/ & pause & exit /b 1)
echo Open AutoPose - starting the offline app (prebuilt, no install needed).
echo First run of pose/depth downloads the AI models once (needs internet), then works offline.
start "" "http://127.0.0.1:4173/?offline=1"
node scripts/serve-dist.mjs
