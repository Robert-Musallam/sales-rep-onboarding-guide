#!/bin/bash
# One M365 license run in the Gusto agent's Chrome. Started by the worker (m365.assign_license).
# Usage: M365_REP_ID=<id> m365-run.sh '<rep json>' [--send]
# Shares the Gusto agent's run lock so the two agents never drive the browser at once.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
REP_JSON="${1:?rep json required}"
MODE="dry_run"; SEND_FLAG=""
[ "${2:-}" = "--send" ] && { MODE="send"; SEND_FLAG="--send"; }
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$HERE/logs"
OUT="$HERE/logs/m365-$TS.json"
LOCK="$HERE/.run.lock"
REP_ID="${M365_REP_ID:-}"
record() {
  [ -n "$REP_ID" ] || return 0
  (cd "$REPO" && zsh -lc "npx tsx gusto-agent/m365-record.ts '$REP_ID' '$MODE' '$OUT'" >> "$HERE/logs/m365-record.log" 2>&1)
}
date +%s > "$LOCK"

WAS_RUNNING=0
ST="$(bash "$HERE/chrome-gusto.sh" status 2>/dev/null || true)"
case "$ST" in running*) WAS_RUNNING=1 ;; esac
bash "$HERE/chrome-gusto.sh" start
rc=$?
if [ $rc -ne 0 ]; then
  printf '{"outcome":"deferred","launcher_exit":%s}\n' "$rc" > "$OUT"
  record; rm -f "$LOCK"; exit $rc
fi
if [ $WAS_RUNNING -eq 1 ]; then
  trap 'rm -f "$LOCK"' EXIT
else
  trap 'bash "$HERE/chrome-gusto.sh" stop >/dev/null 2>&1; rm -f "$LOCK"' EXIT
fi

node "$HERE/m365-license.js" "$REP_JSON" $SEND_FLAG > "$OUT" 2>>"$HERE/logs/m365-license.log"
lrc=$?
echo "m365-license exit $lrc -> $OUT"
record
exit $lrc
