# Claude Grimoire Plugin Launcher

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if Bun is installed
$bunPath = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunPath) {
  Write-Host "Error: Bun is required but not installed." -ForegroundColor Red
  Write-Host "Please install Bun from: https://bun.sh"
  Write-Host ""
  Write-Host "For Windows, download from: https://github.com/oven-sh/bun/releases"
  Read-Host "Press Enter to exit"
  exit 1
}

# Check if binary exists
if (-not (Test-Path "$scriptDir\claude-grimoire-win.exe")) {
  Write-Host "Error: claude-grimoire-win.exe not found" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# Check if resources exist
if (-not (Test-Path "$scriptDir\shared\resources.neu")) {
  Write-Host "Error: resources.neu not found in shared/" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# Copy resources to binary location if needed
if (-not (Test-Path "$scriptDir\resources.neu")) {
  Copy-Item "$scriptDir\shared\resources.neu" "$scriptDir\resources.neu"
}

# Copy licensing CLI if needed
if (-not (Test-Path "$scriptDir\licensing-cli")) {
  Copy-Item "$scriptDir\shared\licensing-cli" "$scriptDir\licensing-cli"
}

Write-Host "Starting Claude Grimoire on Windows..." -ForegroundColor Green
Start-Process "$scriptDir\claude-grimoire-win.exe" -ArgumentList $args
