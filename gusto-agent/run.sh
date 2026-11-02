#!/bin/bash
# One agent run: start the Gusto Chrome, run the skill through Claude Code, stop Chrome.
# Usage: run.sh '<skill arguments>' [--send]
#   run.sh 'rep_name="Test BusinessName"'           dry run (default: never clicks Save)
#   run.sh 'rep_id=123' --send                       live
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ARGS="${1:?skill arguments required}"
MODE="dry_run"
[ "${2:-}" = "--send" ] && MODE="send"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$HERE/logs/run-$TS.json"
ERR="$HERE/logs/run-$TS.err"
PROMPT="$HERE/logs/run-$TS.prompt"
mkdir -p "$HERE/logs"
LOCK="$HERE/.run.lock"
REP_ID="${GUSTO_REP_ID:-}"
record() {
  [ -n "$REP_ID" ] || return 0
  (cd "$REPO" && zsh -lc "npx tsx gusto-agent/record-result.ts '$REP_ID' '$MODE' '$OUT'" >> "$HERE/logs/record.log" 2>&1)
}
date +%s > "$LOCK"
mkdir -p "$HOME/.claude/skills" && cp -R "$HERE/skill/gusto-add-rnb-contractor" "$HOME/.claude/skills/"

bash "$HERE/chrome-gusto.sh" start
rc=$?
if [ $rc -ne 0 ]; then
  printf '{"outcome":"deferred","launcher_exit":%s}\n' "$rc" > "$OUT"
  echo "deferred (launcher exit $rc) -> $OUT"
  record; rm -f "$LOCK"
  exit $rc
fi
trap 'bash "$HERE/chrome-gusto.sh" stop >/dev/null 2>&1; rm -f "$LOCK"' EXIT

node "$HERE/login.js" 2>>"$HERE/logs/login.log"
lrc=$?
if [ $lrc -ne 0 ]; then
  printf '{"outcome":"session","login_exit":%s}\n' "$lrc" > "$OUT"
  if [ $lrc -eq 10 ] || [ $lrc -eq 14 ]; then
    trap 'rm -f "$LOCK"' EXIT
    echo "Gusto needs Robert (login exit $lrc): Chrome left open on the code/check screen -> $OUT"
  else
    echo "sign-in step failed (login exit $lrc) -> $OUT"
  fi
  record
  exit $lrc
fi

# ── Fast path: fixed steps by script (company, duplicates, Basics), AI only for the rest ──
fake_result() {  # $1 = skill-style JSON → a claude-compatible OUT file for record-result.ts
  python3 -c 'import json,sys; r=sys.argv[1]; print(json.dumps({"subtype":"success","total_cost_usd":0,"duration_ms":0,"result":"```json\n"+r+"\n```"}))' "$1" > "$OUT"
}
MODEL_ARGS=""
if [ -n "${GUSTO_REP_JSON:-}" ]; then
  FAST="$HERE/logs/run-$TS.fast.json"
  node "$HERE/fast-add.js" "$GUSTO_REP_JSON" > "$FAST" 2>>"$HERE/logs/fast-add.log"
  frc=$?
  COMPANY="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("company") or "")' "$FAST" 2>/dev/null)"
  REASON="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("reason") or "")' "$FAST" 2>/dev/null)"
  if [ $frc -eq 21 ] || [ $frc -eq 20 ]; then
    fake_result "{\"outcome\":\"stopped\",\"stop_reason\":\"$REASON\",\"gusto_company\":\"$COMPANY\",\"invite_sent\":false,\"documents\":[]}"
    echo "fast path stop ($frc): $REASON"; record; exit 0
  fi
  if [ $frc -eq 0 ] && [ "$MODE" = "dry_run" ]; then
    fake_result "{\"outcome\":\"dry_run_ok\",\"stop_reason\":null,\"gusto_company\":\"$COMPANY\",\"invite_sent\":false,\"documents\":[]}"
    echo "fast path dry run ok"; record; exit 0
  fi
  if [ $frc -eq 0 ]; then
    cat > "$PROMPT" <<P
Use the gusto-add-rnb-contractor skill. A script has ALREADY done Steps 0-4 for this rep and verified them:
signed in, company "$COMPANY" confirmed in the header, duplicate check clean (email, full name and business
name in Active, Onboarding and Dismissed), Basics form filled and read back but NOT saved.
The filled form is open in the existing browser tab whose URL contains /add_team_member/basics. Switch to that
tab; do not open a new tab, do not reload, do not repeat Steps 0-3 or search People again.
Start by checking the Basics fields still match the rep below, then click Save and continue and do Step 5,
Step 6 and Step 7 exactly as written, including the document rule and every stop rule.
Rep: $ARGS mode=send
Use only the gusto-browser tools. Your last message is the skill's JSON result only.
P
    MODEL_ARGS="--model sonnet --max-turns 50"
  else
    echo "fast path could not finish (exit $frc: $REASON) -> full AI skill" >> "$HERE/logs/fast-add.log"
  fi
fi
if [ -z "$MODEL_ARGS" ]; then
cat > "$PROMPT" <<P
Use the gusto-add-rnb-contractor skill with these arguments: $ARGS mode=$MODE
Use only the gusto-browser tools. Follow the skill exactly, including every stop rule.
P
MODEL_ARGS="--max-turns 80"
fi

cd "$REPO" || exit 1
zsh -lc "claude -p --mcp-config gusto-agent/mcp.json --strict-mcp-config \
  --allowedTools 'mcp__gusto-browser__*' --disallowedTools 'Bash' 'Edit' 'Write' \
  $MODEL_ARGS --output-format json" < "$PROMPT" > "$OUT" 2> "$ERR"
crc=$?
echo "claude exit $crc -> $OUT"
record
exit $crc
