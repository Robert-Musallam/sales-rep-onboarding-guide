#!/bin/zsh
# Install (or reinstall) the daily agents' Chrome session check on this machine.
# Usage: ops/install_session_check.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.rnb.check-sessions"
PLIST_SRC="$REPO/ops/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$REPO/gusto-agent/logs" "$HOME/Library/LaunchAgents"
sed "s|__REPO__|$REPO|g" "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed $LABEL (daily 08:00). Log: gusto-agent/logs/check-sessions.log"
echo "Run now: cd $REPO && npx tsx gusto-agent/check-sessions.ts --quiet"
