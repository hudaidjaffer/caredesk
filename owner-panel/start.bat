@echo off
title CareDesk OWNER PANEL
cd /d "%~dp0"

rem Note: no round brackets inside echo text below - Windows misreads them inside IF blocks.

if not exist ..\clinic-app\.env goto noconnection
findstr /r /c:"^DATABASE_URL=postgres" ..\clinic-app\.env >nul
if errorlevel 1 goto noconnection

if not exist ..\clinic-app\node_modules (
  echo First run: installing server components...
  pushd ..\clinic-app
  call npm install --omit=dev --no-fund
  popd
)
if not exist dist\index.html (
  echo First run: building the owner panel screens. This takes a minute...
  pushd ..\frontend
  if not exist node_modules call npm install --no-fund
  call npm run build
  popd
)

echo.
echo Starting the CareDesk Owner Panel... keep this window open while you use it.
echo Close this window to stop the owner panel. Clinics are not affected.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:4000"
node server.js
echo.
echo The owner panel has stopped. If you see an error above, send a screenshot of this window.
pause
exit /b

:noconnection
echo.
echo  The Supabase connection is not set up yet.
echo  Double-click "connect-supabase.bat" in the clinic-app folder first, then start again.
echo.
pause
