@echo off
title CareDesk Clinic Server
cd /d "%~dp0"

rem Note: no round brackets inside echo text below - Windows misreads them inside IF blocks.

if not exist .env copy .env.example .env >nul
findstr /r /c:"^DATABASE_URL=postgres" .env >nul
if errorlevel 1 goto noconnection

if not exist node_modules (
  echo First run: installing server components...
  call npm install --omit=dev --no-fund
)
if not exist dist\index.html (
  echo First run: building the app screens. This takes a minute...
  pushd ..\frontend
  if not exist node_modules call npm install --no-fund
  call npm run build
  popd
)

echo.
echo Starting CareDesk... keep this window open while using the app.
echo Close this window to stop the server.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
node server.js
echo.
echo The clinic app has stopped. If you see an error above, send a screenshot of this window.
pause
exit /b

:noconnection
echo.
echo  CareDesk is not connected to Supabase yet.
echo  Double-click "connect-supabase.bat" in this folder first, then start again.
echo.
pause
