# gusto-agent

Adds a new RNB rep to the right Gusto company as a contractor and sends the Gusto invite,
automatically, when the rep reaches **Info Submitted**. Plan, decisions and phase log: `GUSTO-AGENT-PLAN.md`.

## How a run works
1. `worker/gusto-agent.ts` (onboarding worker, every 60 s) claims new Info Submitted reps once
   (`reps.gusto_agent_status`), queues outbox `gusto.add_contractor`, and the handler starts `run.sh` detached.
2. `run.sh` → `chrome-gusto.sh start` (own profile `~/chrome-gusto`, CDP port 9336; defers while the
   AppFolio :9222 chain runs or memory is low) → `login.js` (deterministic sign-in from Keychain item
   `gusto-agent`; SMS code / CAPTCHA → Robert) → fast path `fast-add.js` when `gusto_agent_fast=true`
   (company switch, duplicate check, Basics fill) → Claude Code skill `gusto-add-rnb-contractor`
   (Playwright MCP, `mcp.json`) for save → invite → documents → verify → `record-result.ts` →
   `chrome-gusto.sh stop`.
3. Results: `reps.gusto_agent_*`, `onboarding.gusto_agent_runs`, rep timeline, alerts (`worker/logs/alerts.log`).

## Switches (`onboarding.app_settings`)
| Key | Meaning |
|---|---|
| `gusto_agent_enabled` | master on/off |
| `gusto_agent_mode` | `dry_run` (fill, never save) or `send` |
| `gusto_agent_territories` | territories handled automatically; others → `manual` + alert |
| `gusto_agent_fast` | use the scripted fast path |
| `gusto_agent_test_emails` | test inboxes allowed on is_test reps |

`npx tsx scripts/gusto_agent_settings.ts` (show) · `... --mode=send --send` (change) ·
`npx tsx scripts/gusto_agent_status.ts` (state) · `npx tsx scripts/gusto_agent_rearm.ts <rep_id> --send`.

## Files
| File | What |
|---|---|
| `chrome-gusto.sh` | on-demand Chrome (`start`, `signin`, `stop`, `status`) |
| `login.js` | Gusto sign-in from Keychain (never logs or hands the password to the AI) |
| `fast-add.js` | scripted company switch, duplicate check, Basics fill (no AI) |
| `run.sh` | one run end to end; dry run unless `--send` |
| `record-result.ts` | writes the outcome, re-queues waits, alerts |
| `skill/gusto-add-rnb-contractor/SKILL.md` | the skill (copied to `~/.claude/skills` on every run) |
| `wire-worker.py` | one-time wiring of the worker (applied 2026-10-30) |
| `open-claude-chrome.command` | opens the dedicated Claude-in-Chrome profile `~/chrome-claude` |
