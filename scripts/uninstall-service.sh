#!/bin/bash
# Remove the SquidPanel login service. Running Minecraft servers keep running.
LABEL="com.squidpanel.panel"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "SquidPanel service removed. Start it manually with: npm start"
