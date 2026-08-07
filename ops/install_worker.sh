#!/bin/zsh
# Install (or reinstall) the onboarding worker launchd job on this machine.
# Idiom copied from the appfolio daemon's install_launch_agent.sh.
# Usage: ops/install_worker.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.rnb.onboarding-worker"
PLIST_SRC="$REPO/ops/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$REPO/worker/logs" "$HOME/Library/LaunchAgents"
sed "s|__REPO__|$REPO|g" "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed $LABEL (repo: $REPO). Logs: worker/logs/worker.log"
MODE=$(grep -A1 RNB_AUTOMATION_MODE "$PLIST_DST" | grep string | sed 's/<[^>]*>//g' | tr -d ' \t')
echo "Mode: $MODE (recipient allowlists per PILOT_* in .env.local)"
