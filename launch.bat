@echo off
REM Claude Grimoire Plugin Launcher

set SCRIPT_DIR=%~dp0

REM Check if Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo Error: Bun is required but not installed.
  echo Please install Bun from: https://bun.sh
  echo.
  echo For Windows, download from: https://github.com/oven-sh/bun/releases
  pause
  exit /b 1
)

REM Check if binary exists
if not exist "%SCRIPT_DIR%claude-grimoire-win.exe" (
  echo Error: claude-grimoire-win.exe not found
  pause
  exit /b 1
)

REM Check if resources exist
if not exist "%SCRIPT_DIR%shared\resources.neu" (
  echo Error: resources.neu not found in shared/
  pause
  exit /b 1
)

REM Copy resources to binary location if needed
if not exist "%SCRIPT_DIR%resources.neu" (
  copy "%SCRIPT_DIR%shared\resources.neu" "%SCRIPT_DIR%resources.neu"
)

REM Copy grimoire CLI if needed
if not exist "%SCRIPT_DIR%grimoire-cli" (
  copy "%SCRIPT_DIR%shared\grimoire-cli" "%SCRIPT_DIR%grimoire-cli"
)

echo Starting Claude Grimoire on Windows...
start "" "%SCRIPT_DIR%claude-grimoire-win.exe" %*
