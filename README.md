# Claude Grimoire - Plugin Version

## Overview
This is the plugin version of Claude Grimoire that requires Bun to be installed on the system.
All platform binaries share the same resources for efficient distribution.

## Requirements
- **Bun runtime** must be installed: https://bun.sh
  - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
  - Windows: Download from GitHub releases

## Installation
1. Ensure Bun is installed and available in PATH
2. Extract all files maintaining the directory structure
3. Use the appropriate launcher for your platform

## Directory Structure
```
dist/plugin/
├── claude-grimoire-mac       # macOS binary
├── claude-grimoire-win.exe    # Windows binary
├── claude-grimoire-linux      # Linux binary
├── shared/
│   ├── resources.neu          # Shared app resources
│   └── licensing-cli          # Licensing component (TypeScript)
├── launch.sh                  # Unix launcher (macOS/Linux)
├── launch.bat                 # Windows batch launcher
└── launch.ps1                 # Windows PowerShell launcher
```

## Running
### macOS/Linux
```bash
./launch.sh
```

### Windows
Double-click `launch.bat` or run:
```powershell
.\launch.ps1
```

## Features
- Full licensing support
- Shared resources across platforms
- Requires Bun runtime (not embedded)
- Smaller download size

## Troubleshooting
If you get "Bun is required but not installed":
1. Install Bun from https://bun.sh
2. Restart your terminal/command prompt
3. Verify with: `bun --version`

Version: 1.0.7
