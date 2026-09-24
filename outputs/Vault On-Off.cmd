@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js could not be found. Physical Music Vault cannot start.
  echo Install Node.js, then try again.
  pause
  exit /b 1
)

if not exist "%~dp0..\node_modules\cheerio\package.json" (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo The free search dependency is not installed and npm could not be found.
    echo Reinstall Node.js with npm, then try again.
    pause
    exit /b 1
  )
  echo First start: installing the free local dependencies...
  call npm.cmd install --prefix "%~dp0.." --omit=dev
  if errorlevel 1 (
    echo Dependencies could not be installed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

node.exe "%~dp0vault-toggle.js" %*
echo.
if errorlevel 1 echo The switch could not complete. The message above explains why.
if not defined VAULT_NO_PAUSE pause
