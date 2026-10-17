#!/usr/bin/env bash
# Launch Discord with Chrome DevTools Protocol (CDP) enabled.
# Required for the mcp-discord MCP tools (Playwright connectOverCDP).
#
# Usage:
#   ./scripts/launch-discord.sh          # Launch with CDP on port 9222
#   ./scripts/launch-discord.sh 9333     # Custom port
#   ./scripts/launch-discord.sh --kill   # Kill existing Discord and relaunch

set -euo pipefail

CDP_PORT="${1:-9222}"
DISCORD_APP="/Applications/Discord.app/Contents/MacOS/Discord"

if [[ "${1:-}" == "--kill" ]]; then
  CDP_PORT="${2:-9222}"
  echo "Killing existing Discord process..."
  pkill -x Discord 2>/dev/null || true
  sleep 2
fi

if ! [[ -x "$DISCORD_APP" ]]; then
  echo "ERROR: Discord not found at $DISCORD_APP"
  exit 1
fi

# Check if Discord is already running
if pgrep -x Discord >/dev/null 2>&1; then
  # Check if it has CDP enabled
  if curl -s --connect-timeout 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "Discord is already running with CDP on port ${CDP_PORT}"
    curl -s "http://localhost:${CDP_PORT}/json/version" | python3 -m json.tool 2>/dev/null || true
    exit 0
  else
    echo "ERROR: Discord is running but CDP is not enabled on port ${CDP_PORT}."
    echo "  Quit Discord (Cmd+Q) and rerun, or use: ./scripts/launch-discord.sh --kill"
    exit 1
  fi
fi

echo "Launching Discord with CDP on port ${CDP_PORT}..."
"$DISCORD_APP" --remote-debugging-port="$CDP_PORT" &>/dev/null &
DISCORD_PID=$!

# Wait for CDP to become available
echo -n "Waiting for CDP endpoint"
for i in $(seq 1 15); do
  if curl -s --connect-timeout 1 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo " ready!"
    echo "Discord PID: ${DISCORD_PID}, CDP: http://localhost:${CDP_PORT}"
    curl -s "http://localhost:${CDP_PORT}/json/version" | python3 -m json.tool 2>/dev/null || true
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo " timeout!"
echo "WARNING: Discord launched but CDP did not respond within 15 seconds."
echo "Check if Discord opened correctly and try: curl http://localhost:${CDP_PORT}/json/version"
exit 1
