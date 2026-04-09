#!/bin/bash
# Claude Grimoire Plugin Launcher

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
  echo "Error: Bun is required but not installed."
  echo "Please install Bun from: https://bun.sh"
  echo ""
  echo "Quick install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# Determine platform
PLATFORM=""
BINARY=""
case "$(uname -s)" in
  Darwin*)
    PLATFORM="macOS"
    BINARY="claude-grimoire-mac"
    ;;
  Linux*)
    PLATFORM="Linux"
    BINARY="claude-grimoire-linux"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)"
    exit 1
    ;;
esac

# Check if binary exists
if [ ! -f "$SCRIPT_DIR/$BINARY" ]; then
  echo "Error: $BINARY not found in $SCRIPT_DIR"
  exit 1
fi

# Check if resources exist
if [ ! -f "$SCRIPT_DIR/shared/resources.neu" ]; then
  echo "Error: resources.neu not found in $SCRIPT_DIR/shared/"
  exit 1
fi

# Copy resources to binary location if needed
if [ ! -f "$SCRIPT_DIR/resources.neu" ]; then
  cp "$SCRIPT_DIR/shared/resources.neu" "$SCRIPT_DIR/resources.neu"
fi

# Copy grimoire CLI if needed
if [ ! -f "$SCRIPT_DIR/grimoire-cli" ]; then
  cp "$SCRIPT_DIR/shared/grimoire-cli" "$SCRIPT_DIR/grimoire-cli"
fi

echo "Starting Claude Grimoire on $PLATFORM..."
exec "$SCRIPT_DIR/$BINARY" "$@"
