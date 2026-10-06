#!/bin/bash
# Expose SquidPanel on a Cloudflare hostname through a dedicated, always-on Cloudflare Tunnel.
#
#   scripts/install-tunnel.sh server.example.com [origin-cert]
#
# The origin cert comes from `cloudflared tunnel login` (pick the zone that owns the
# hostname). The script is idempotent: re-running it reuses the tunnel and DNS record.
set -euo pipefail

HOSTNAME="${1:?usage: install-tunnel.sh <hostname> [origin-cert]}"
CERT="${2:-$HOME/.cloudflared/cert.pem}"
NAME="squidpanel"
PORT="${PORT:-3333}"
LABEL="com.squidpanel.tunnel"
CF="$(command -v cloudflared)" || { echo "Install cloudflared first: brew install cloudflared"; exit 1; }
CONFIG="$HOME/.cloudflared/$NAME.yml"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/SquidPanel"
DOMAIN="gui/$(id -u)"

[ -f "$CERT" ] || { echo "Origin cert not found: $CERT (run: cloudflared tunnel login)"; exit 1; }

# Reuse the tunnel if it already exists.
ID="$("$CF" --origincert "$CERT" tunnel list -n "$NAME" -o json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin) or []; print(d[0]["id"] if d else "")')"
if [ -z "$ID" ]; then
  echo "Creating tunnel '$NAME'…"
  "$CF" --origincert "$CERT" tunnel create "$NAME"
  ID="$("$CF" --origincert "$CERT" tunnel list -n "$NAME" -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')"
fi
CREDS="$HOME/.cloudflared/$ID.json"
[ -f "$CREDS" ] || { echo "Missing credentials $CREDS for existing tunnel $ID — delete the tunnel or restore the file."; exit 1; }
echo "Tunnel: $NAME ($ID)"

echo "Pointing $HOSTNAME at the tunnel…"
"$CF" --origincert "$CERT" tunnel route dns "$ID" "$HOSTNAME"

cat > "$CONFIG" <<YAML
# SquidPanel public hostname (managed by scripts/install-tunnel.sh)
tunnel: $ID
credentials-file: $CREDS
ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$PORT
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
YAML
"$CF" tunnel --config "$CONFIG" ingress validate

mkdir -p "$LOG_DIR"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CF</string><string>--no-autoupdate</string>
    <string>tunnel</string><string>--config</string><string>$CONFIG</string><string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/tunnel.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/tunnel.log</string>
</dict>
</plist>
PLIST
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
echo "✓ https://$HOSTNAME → http://localhost:$PORT (service $LABEL, logs $LOG_DIR/tunnel.log)"
