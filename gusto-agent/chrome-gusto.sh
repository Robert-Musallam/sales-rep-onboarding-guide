#!/bin/bash
# On-demand Chrome for the Gusto onboarding agent.
#
# Isolation contract (see GUSTO-AGENT-PLAN.md, "Phase 0"):
#   - own profile  ~/chrome-gusto   (AppFolio = ~/chrome-appfolio, Naz = ~/chrome-naz)
#   - own port     9336             (AppFolio 9222, Lowe's 9223, Naz 9334)
#   - only ever starts/stops processes whose --user-data-dir is EXACTLY this profile
#   - started for a run and stopped after it, so it holds no memory between reps
#
# Usage:
#   chrome-gusto.sh start            launch for an agent run (refuses under memory
#                                    pressure or while an AppFolio :9222 chain runs)
#   chrome-gusto.sh signin           attended: launch with Gusto + Holding OS open so
#                                    Robert can sign in / enter the SMS code
#   chrome-gusto.sh stop             quit this profile's Chrome only
#   chrome-gusto.sh status           print state, never changes anything
#
# Exit codes: 0 ok · 2 usage · 3 port owned by another browser · 4 low memory
#             5 AppFolio chain busy · 6 Chrome did not come up
set -euo pipefail

PORT="${GUSTO_CDP_PORT:-9336}"
PROFILE="${GUSTO_CHROME_PROFILE:-$HOME/chrome-gusto}"
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
APPFOLIO_LOCK="${APPFOLIO_LOCK:-$HOME/appfolio-pipeline/.locks/chain-9222}"
MIN_FREE_PCT="${GUSTO_MIN_FREE_PCT:-20}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HERE/logs"
mkdir -p "$LOG_DIR"

log() { printf '[chrome-gusto %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_DIR/chrome-gusto.log" >&2; }

browser_pids() {
  local snapshot
  snapshot="$(ps -axo pid=,command=)"
  printf '%s\n' "$snapshot" | awk -v want="--user-data-dir=$PROFILE" -v me="$$" '{
    if ($1 == me) next
    if (index($0, "/Contents/MacOS/Google Chrome") == 0) next
    hit = 0; child = 0
    for (i = 2; i <= NF; i++) {
      if ($i == want) hit = 1
      if (index($i, "--type=") == 1) child = 1
    }
    if (hit && !child) print $1
  }'
}

port_answers() { curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }

free_pct() {
  if command -v memory_pressure >/dev/null 2>&1; then
    memory_pressure -Q 2>/dev/null | awk -F': ' '/free percentage/ {gsub("%","",$2); print $2}'
  else
    echo 100
  fi
}

launch() {
  local first_url="$1"; shift
  mkdir -p "$PROFILE"
  nohup "$CHROME_BIN" \
    --remote-debugging-port="$PORT" \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check \
    "$first_url" "$@" >>"$LOG_DIR/chrome.log" 2>&1 &
  local _
  for _ in $(seq 1 30); do
    if port_answers; then log "up on :$PORT (pid $(browser_pids | tr '\n' ' '))"; return 0; fi
    sleep 1
  done
  log "Chrome did not answer on :$PORT within 30s"
  return 6
}

guard_port() {
  if port_answers && [ -z "$(browser_pids)" ]; then
    log "port $PORT already answers but not from $PROFILE — refusing (another browser owns it)"
    exit 3
  fi
}

cmd="${1:-}"
case "$cmd" in
  status)
    pids="$(browser_pids | tr '\n' ' ')"
    if [ -n "$pids" ]; then echo "running pid=$pids port=$PORT profile=$PROFILE"; else echo "stopped profile=$PROFILE"; fi
    if port_answers; then echo "port $PORT: answering"; else echo "port $PORT: closed"; fi
    echo "memory free: $(free_pct)% (min for runs: $MIN_FREE_PCT%)"
    if [ -d "$APPFOLIO_LOCK" ]; then echo "AppFolio :9222 chain: BUSY"; else echo "AppFolio :9222 chain: idle"; fi
    ;;
  start)
    guard_port
    if [ -n "$(browser_pids)" ] && port_answers; then log "already running"; exit 0; fi
    if [ -d "$APPFOLIO_LOCK" ]; then log "AppFolio chain holds $APPFOLIO_LOCK — deferring"; exit 5; fi
    pct="$(free_pct)"
    if [ "${pct:-100}" -lt "$MIN_FREE_PCT" ]; then log "memory free ${pct}% < ${MIN_FREE_PCT}% — deferring"; exit 4; fi
    launch "about:blank"
    ;;
  signin)
    guard_port
    if [ -n "$(browser_pids)" ]; then log "already running — use the open window"; exit 0; fi
    launch "chrome://settings/onStartup" "https://app.gusto.com/login" "https://gcv-renewals.vercel.app/rnb/reps"
    echo "In the window that opened:"
    echo "  1. Settings tab: On start-up -> Continue where you left off (keeps the Gusto login across restarts)"
    echo "  2. Gusto tab: sign in, enter the SMS code, tick Remember this device"
    echo "  3. Holding OS tab: sign in"
    echo "Then: bash $0 stop"
    ;;
  stop)
    pids="$(browser_pids)"
    if [ -z "$pids" ]; then log "not running"; exit 0; fi
    log "stopping pid(s) $(echo $pids)"
    kill -TERM $pids 2>/dev/null || true
    for _ in $(seq 1 15); do
      [ -z "$(browser_pids)" ] && { log "stopped"; exit 0; }
      sleep 1
    done
    log "still running after 15s — left alone (no SIGKILL: it may be saving the session)"
    exit 1
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
