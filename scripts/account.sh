#!/bin/bash
# Account recovery that is safe while the service runs: the panel keeps its state in
# memory and saves it on exit, so it must be stopped while the CLI edits data/panel.json.
#   scripts/account.sh list-users
#   scripts/account.sh reset-password <username> <new-password>
#   scripts/account.sh create-owner <username> <password>
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="gui/$(id -u)/com.squidpanel.panel"
PLIST="$HOME/Library/LaunchAgents/com.squidpanel.panel.plist"

running=0
if launchctl print "$SERVICE" >/dev/null 2>&1; then
  running=1
  launchctl bootout "$SERVICE" 2>/dev/null
  sleep 1
fi

node "$APP_DIR/server/cli.js" "$@"
status=$?

if [ "$running" = 1 ]; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Panel service restarted."
fi
exit $status
