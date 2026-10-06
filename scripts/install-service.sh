#!/bin/bash
# Install SquidPanel as an always-on macOS login service (launchd).
# It starts at login, restarts itself if it ever exits, and leaves running
# Minecraft servers alone when it restarts (it re-attaches to them).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.squidpanel.panel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/SquidPanel"
PORT="${PORT:-3333}"
HOST="${HOST:-0.0.0.0}"
NODE_BIN="$(command -v node || true)"
DOMAIN="gui/$(id -u)"

[ -n "$NODE_BIN" ] || { echo "Node.js 20+ is required (brew install node)"; exit 1; }
echo "== SquidPanel service installer =="
echo "App:  $APP_DIR"
echo "Node: $NODE_BIN ($("$NODE_BIN" -v))"

cd "$APP_DIR"
if [ ! -d node_modules ]; then echo "Installing dependencies…"; npm install; fi
if [ ! -f dist/index.html ] || [ "${REBUILD:-0}" = "1" ]; then echo "Building the web UI…"; npm run build; fi

# Retire the older Python panel's service so two panels never manage the same servers.
if launchctl print "$DOMAIN/com.mc.localpanel" >/dev/null 2>&1; then
  echo "Stopping the old mc-panel service (com.mc.localpanel)…"
  launchctl bootout "$DOMAIN/com.mc.localpanel" 2>/dev/null || true
fi
if [ -f "$HOME/Library/LaunchAgents/com.mc.localpanel.plist" ]; then
  mv "$HOME/Library/LaunchAgents/com.mc.localpanel.plist" "$HOME/Library/LaunchAgents/com.mc.localpanel.plist.disabled"
  echo "  (its plist was renamed to com.mc.localpanel.plist.disabled — files in ~/mc-panel are untouched)"
fi

# Stop a manually started copy of this panel that would hold the port.
for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  if ps -o command= -p "$pid" | grep -q "server/index.js"; then
    echo "Stopping manually started panel (pid $pid) on port $PORT…"
    kill "$pid" 2>/dev/null || true
  fi
done

mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key><string>$PORT</string>
    <key>HOST</key><string>$HOST</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <!-- Minecraft servers are separate process groups; never kill them with the panel. -->
  <key>AbandonProcessGroup</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG_DIR/panel.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/panel.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/api/setup" >/dev/null 2>&1 && break
  sleep 0.5
done

echo
if curl -fsS "http://127.0.0.1:$PORT/api/setup" >/dev/null 2>&1; then
  echo "✓ SquidPanel is running and will start automatically at login."
else
  echo "! The service was installed but is not answering yet — check $LOG_DIR/panel.err.log"
fi
echo "  Open:     http://localhost:$PORT"
echo "  On LAN:   http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:$PORT"
echo "  Logs:     $LOG_DIR"
echo "  Restart:  launchctl kickstart -k $DOMAIN/$LABEL"
echo "  Remove:   $APP_DIR/scripts/uninstall-service.sh"
