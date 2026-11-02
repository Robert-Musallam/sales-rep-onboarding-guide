# Gusto onboarding agent — build plan and phase loops

Goal: when a rep reaches **Info Submitted**, add them to the right Gusto company as a
contractor (Sales / Design Consultant) and send the Gusto invite — automatically, logged,
and without touching any other agent on the Mac mini.

Full research plan: "Gusto onboarding agent execution plan.md" (chat deliverable, 2026-10-30).

## Decisions (fixed)
| # | Decision |
|---|---|
| D1 | Runs on the Mac mini, under Robert's Gusto admin login |
| D2 | Browser-only (no Gusto API) |
| D3 | Trigger: automatic when a rep reaches `info_submitted` |
| D4 | Approval: standing go-ahead — no per-rep approval; every send logged |
| D5 | Anything unexpected → stop and alert Robert |
| D6 | Holding OS checklist is NOT touched by the agent (checking "Gusto" creates the M365 user; the existing signature watcher completes it when the rep signs) |
| D7 | Test rep "Robert Test" (Las Vegas). Approved test inboxes: `Rmusallam@rocknblocklandscape.com`, `josebrest25@gmail.com` (Jose, approved 2026-10-30). Robert creates and cleans up the test record |
| D8 | Volume 2–3 reps/week |
| D9 | Own Chrome profile `~/chrome-gusto`, CDP port **9336**, started per run and stopped after (memory) |
| D10 | Driven like AppFolio: Playwright over CDP (`mcp.json`), not the Claude in Chrome extension |
| D12 | Option B: when Gusto signs out, `login.js` (deterministic, not the AI) fills email + password from Keychain item `gusto-agent`; Robert enters the SMS code; one attempt per 60 min, never retries a rejected password |
| D11 | Territories (Robert, 2026-11-02): auto = AZ, Tampa, LV, Utah, San Diego, OC/IE; manual = Colorado, Santa Clara. California treated like every location (1099 + contractor agreement) by Robert's decision |

## Isolation contract (verified 2026-10-30, Phase 0)
| Agent | Profile | Port | Touched by Gusto agent? |
|---|---|---|---|
| AppFolio pipeline | ~/chrome-appfolio | 9222 | No. Gusto runs defer while `appfolio-pipeline/.locks/chain-9222` exists |
| Lowe's / BillTrust | chrome-cdp-profile | 9223 | No |
| Naz | ~/chrome-naz | 9334 | No |
| mem_guardian | — | — | Only reaps "Chrome for Testing"; never a normal Chrome on ~/chrome-gusto |
| **Gusto agent** | **~/chrome-gusto** | **9336** | `chrome-gusto.sh` only starts/stops processes whose `--user-data-dir` is exactly ~/chrome-gusto |
Memory: 16 GB, heavy swap. Runs refuse to start below 20% free (`GUSTO_MIN_FREE_PCT`).

## How every phase runs: the loop
```
BUILD  → do the phase's work
TEST   → run the phase's checks (dry first, live only where the phase allows)
FIX    → patch what failed, note it in the phase log below
GATE   → all exit criteria met? yes → next phase · no → back to BUILD (max 3 loops, then stop and ask Robert)
```
Robert-only steps pause the loop and are posted in the chat.

---

## Phase 0 — Isolation + scaffold   ✅ loop 1 done (2026-10-30)
BUILD: `chrome-gusto.sh`, `mcp.json` (Playwright MCP 0.0.83 → :9336), skill adapted to Playwright, this plan.
TEST: script syntax; port/profile collision scan across appfolio-pipeline, gcv-mac-automation, bin; process-match test against the real AppFolio/Naz command lines.
Exit criteria:
- [x] No other script/plist uses port 9336 or ~/chrome-gusto
- [x] Launcher matches only `--user-data-dir=~/chrome-gusto` (tested against AppFolio, Naz, Lowe's command lines)
- [x] Launcher defers on AppFolio lock and on low memory; never SIGKILLs
- [x] Nothing committed, deployed, or started
- [x] Skill installed in ~/.claude/skills (2026-10-30)
- [x] Gusto Chrome launched on :9336 for first sign-in (2026-10-30)
- [x] Robert signed in to Gusto (SMS) + Holding OS; Gusto Chrome stopped cleanly, session saved (2026-10-30 13:56)
- [ ] ⚠️ **Robert:** engage counsel on 1099 / Employment agreement (D11)

## Phase 1 — Attended UI mapping (test rep, Las Vegas → Rock N Block llc)
BUILD: run the skill in `mode=dry_run` against the TEST card, then `mode=send` with Robert watching.
TEST: compare each Gusto screen to SKILL.md.
Exit criteria:
- [x] 3 clean dry runs (no stop, correct company, form filled correctly) — 2026-10-30, Robert Test
- [x] Invite is sent by **Send and continue** on the *Send invitation* page, BEFORE documents (Gusto help center was right); SKILL.md reordered
- [x] Document rule (Robert, 2026-10-30): send ONLY the W-9 + the company's independent contractor agreement (AZ: DESIGN CONSULTANT AZ · Rock N Block llc: Sales independant contractor 2025 · CO/FL/SD: the one doc named *contractor*, else stop)
- [x] 1 attended send: Robert Test added in Rock N Block llc, invite emailed to josebrest25@gmail.com (2026-10-30 22:00Z, 70 turns, 170 s, $1.45)
- [x] Holding OS: Robert Test card no longer exists (removed by Robert)
- [ ] Gusto: Robert Test sits in Rock N Block llc → People → Onboarding (Invited, 0%) — Robert removes it

## Phase 2 — Unattended command-line run
BUILD: `run.sh <rep_id> [--send]` → `chrome-gusto.sh start` → `claude -p "/gusto-add-rnb-contractor …" --mcp-config gusto-agent/mcp.json --allowedTools "mcp__gusto-browser__*" --output-format json --max-turns 60` → parse JSON → `chrome-gusto.sh stop`. Dry run unless `--send`.
TEST: run from a plain launchd-like shell (no Terminal), with Chrome closed beforehand.
Exit criteria:
- [ ] 3 unattended dry runs return valid JSON, Chrome is closed afterwards
- [ ] Simulated expired session → `gusto_signin_required`, no clicks
- [ ] AppFolio lock present → run defers, nothing launched

## Phase 3 — Wire into the onboarding worker (no new trigger)
BUILD (files only, then approved apply):
- Migration: `reps.gusto_company`, `reps.gusto_added_at`, `reps.gusto_run_note`; reuse `reps.gusto_status`
  (`queued → in_progress → added | needs_review | stopped | dry_run_ok`); app_settings
  `gusto_agent_enabled` (pause switch), `gusto_agent_mode` (dry_run|send), `gusto_agent_territories` (D11 allowlist).
- Worker sweep `sweepGustoAgent()`: reps with `status=info_submitted`, `gusto_status is null`,
  `is_test=false` (or the test email), territory in allowlist → `gusto_status=queued` + outbox
  `gusto.add_contractor` (dedupe `gusto.add_contractor:<rep>`).
- Handler: respects kill switch + pause; spawns `run.sh` detached (own lock) so the 60 s pass is never blocked.
- `in_progress` older than 45 min → `needs_review` + alert. Never auto-reset to `queued` (a crash after the click would double-invite).
- Alerts through `worker/alert.ts`.
TEST: `npm run migrate` only after Robert approves the file; worker in `gusto_agent_mode=dry_run`.
Exit criteria:
- [ ] Re-running the sweep never queues the same rep twice
- [ ] Pause switch stops new runs within one pass
- [ ] Existing reps are not swept (backfill `gusto_status='legacy'` for reps already past info_submitted)

## Phase 4 — Shadow mode (real reps, dry)
Agent runs dry on every real rep and alerts "would add X to Y"; Robert keeps adding by hand.
Exit: 5 matching reps, 0 wrong companies, 1 reboot survived.

## Phase 5 — Go live by company
One attended live send per Gusto company, then add it to `gusto_agent_territories`.
Exit: 2 weeks, every invite logged, 0 manual Gusto adds for allowlisted territories.

---

## Phase log
- 2026-10-30 · Phase 0 loop 1 · scaffold written; isolation verified (port/profile scan clean, process-match test only hits ~/chrome-gusto, shellcheck clean after 2 fixes). Open: Robert install + sign-in, counsel.
- 2026-10-30 · Phase 0 loop 2 · live test on the Mini. Bug: `status` reported "running" with nothing running (awk saw its own command line in the ps pipe) → fixed by snapshotting ps first and requiring the Chrome binary; re-tested. Exec bit lost when files are rewritten from the Cowork VM → scripts are invoked with `bash`. Skill installed; Gusto Chrome up on :9336 (pid 56712) waiting for Robert's sign-in.
- 2026-10-30 · Phase 0 loop 3 · sign-in done, Chrome stopped cleanly (pid 56712), cookie store saved, port 9336 closed, memory 38% free, AppFolio idle. Phase 0 exit criteria met except ⚠️ counsel (does not block Phase 1).
- 2026-10-30 · Phase 1 loop 1 · run.sh + Claude Code (`claude -p`, Playwright MCP on :9336) worked end to end: attempt 1 deferred correctly (AppFolio chain lock), attempt 2 ran 5 turns / 13 s / $0.19, honored the stop rule `gusto_signin_required` (Gusto login did not survive the Chrome restart), created nothing, Chrome stopped. Fix: signin now opens chrome://settings/onStartup so the profile keeps session cookies (Continue where you left off); Robert re-signs in.
- 2026-10-30 · Phase 1 loop 2 · Robert chose Option B (auto password, human SMS code). Added `login.js` (playwright-core 1.63.0 over CDP; Keychain → page, never logged), wired into run.sh before the AI step; on code/CAPTCHA the Gusto Chrome stays open and an alert is written (alerts.log + macOS notification).
- 2026-10-30 · Phase 1 loop 3 · Keychain item saved by Robert. login.js run 1: Gusto showed an account chooser (not recognised → exit 15, stopped safely). Added chooser handling. Run 2: chooser → password from Keychain → Companies page, exit 0 in ~10 s, no SMS code (device remembered). Gusto does NOT keep the session across a Chrome restart, so every run signs in via login.js.
- 2026-10-30 · Phase 1 dry run 2 · full chain worked unattended: login.js signed in → Claude Code (9 turns, 21 s, $0.25, 0 permission denials) → stopped correctly with `rep_not_found:Test BusinessName` (the TEST card is no longer in Info Submitted; only real rep Kristy O'Leary — Tampa is). Nothing opened or created in Gusto; Chrome stopped. Added the rep_not_found rule to SKILL.md.
- 2026-10-30 · Phase 1 loop 4 · login cooldown wrongly counted a SUCCESSFUL sign-in (3 runs deferred, exit 13) → fixed: stamp cleared on success. Then 3/3 dry runs `dry_run_ok` on Robert Test (Las Vegas, Individual, josebrest25@gmail.com): auto sign-in → Rock N Block llc confirmed in header → duplicate check Active/Onboarding/Dismissed clean → Basics filled correctly → Save NOT clicked. 53–59 turns, 108–117 s, ~$0.90/run, 0 permission denials. Run 3 met a Gusto promo dialog and closed it → added an explicit Pop-ups rule to SKILL.md. Card shows no TEST tag (created in Holding OS UI). Business-contractor path still untested.
- 2026-10-30 · Phase 1 LIVE test · Robert Test created in Rock N Block llc; invite sent at the *Send invitation* page (Send and continue) — before documents. Documents page listed W-9 + Commission Agreement, Non Compete Sales, Employee info, Sales independant contractor 2025, Employee Handbook; no Employment agreement, no territory doc → agent stopped with `unexpected_document` before the final save (correct). Skill step 6 rewritten (invite first, then per-company document allow-list; unconfigured company → stop).
- 2026-10-30 · Phase 1 close-out · document rule set by Robert; skill step 6 updated. Retire script found no Robert Test row (already removed); read-only Gusto lookup: Robert Test in Rock N Block llc → People → Onboarding, Invited, 0%. Phase 1 complete except the Gusto cleanup (Robert). Phase 2 criteria met by the runs above (unattended, JSON result, sign-in, AppFolio defer, Chrome closed).
- 2026-10-30 · Phase 3 loop 1 (files only, nothing applied or wired) · migration `20261030190000_gusto_agent.sql` (new gusto_agent_* columns — existing gusto_status untouched; gusto_agent_runs log; settings enabled=false, mode=dry_run, territories AZ/CO/Tampa/LV/Utah, test emails; existing reps backfilled 'legacy'); `worker/gusto-agent.ts` (sweep + handler, spawns run.sh detached, stale in_progress→needs_review, non-allowlisted territory→manual+alert); `gusto-agent/record-result.ts` (writes outcome, re-queues waits, alerts); run.sh lock + record hook; `gusto-agent/wire-worker.py` (idempotent wiring, tested on a copy). `tsc --noEmit` clean before AND after wiring. Open risk: launchd may kill the detached run when the worker pass exits → verify in the Phase 3 test (fallback: AbandonProcessGroup in the plist).
- 2026-10-30 · Phase 3 apply · Robert approved; migration 20261030190000_gusto_agent.sql applied (only pending file); worker wired via wire-worker.py; typecheck OK; worker pass at 22:55Z ran clean with the new sweep (agent still disabled). Added scripts/gusto_agent_settings.ts (show / switch, writes only with --send).
- 2026-11-02 · Territories changed by Robert: auto = Arizona, Tampa, Las Vegas, Utah, San Diego, OC/IE, Santa Clara; Colorado → manual. ⚠️ California now auto-sent while the counsel question is still open (Robert's call). Santa Clara has no Gusto company mapping in the skill yet → runs will stop `unmapped_location` until Robert names it.
- 2026-11-02 · Robert: California territories get the same treatment as every other location (1099 contractor + W-9 + contractor agreement only) — his decision, counsel not consulted. Santa Clara moved to manual (no Gusto company mapping). Auto = AZ, Tampa, LV, Utah, San Diego, OC/IE · Manual = Colorado, Santa Clara.
- 2026-11-02 · Phase 3 TEST PASSED · rep #38 Robert Test2 (Las Vegas, Business "Business LLC", josebrest25@gmail.com) submitted 13:24Z → worker queued it automatically → detached run survived the worker pass (launchd OK) → first attempt deferred on the AppFolio lock → retried 15 min later on schedule → sign-in, Rock N Block llc, Contractor (Business) + business name filled, stopped before Save → recorded: reps.gusto_agent_status=dry_run_ok, gusto_agent_runs #1. 48 turns, 117 s, $0.92. Findings: Business form has no 'Send a contractor agreement' checkbox; duplicate check can't rely on People search for emails → skill now opens Onboarding people to compare emails. Old 'Robert Test' (same email) still in Gusto Onboarding.
- 2026-11-02 · GO LIVE (mode=send) · first fully automatic live run, rep #38 Robert Test2 (Business LLC): deferred once (AppFolio lock), retried, added in Rock N Block llc, invite sent to josebrest25@gmail.com, documents = W-9 + Sales independant contractor 2025 (unchecked Commission Agreement, Non Compete Sales, Employee info, Employee Handbook; Employee Agreement already off), saved. Recorded needs_review only because Step 7 expected the first name while Gusto shows business contractors by business name → Step 7 fixed. 143 turns, 452 s, $1.89. Deferral retry shortened to 5 min. Old 'Robert Test' no longer in Gusto Onboarding.
- 2026-11-02 · Speed loop 1 · `fast-add.js` (playwright-core over CDP, no AI): company switch + header check, duplicate check (email, full name, business name × Active/Onboarding/Dismissed; Onboarding read whole + same-last-name profiles opened for email), Basics fill + read-back, stops UNSAVED. Dry tests on the Mini: new person → basics_filled in 33 s; existing Business LLC → duplicate stop in 16 s. 3 fixes during the loop (strict locator, hidden search box on Onboarding tab, slow-loading Country). Wired into run.sh: dry mode = script only ($0); send mode = script + AI (Sonnet, ≤50 turns) only for Save → employment → invite → documents → verify; any unexpected script exit → full AI skill fallback; duplicate/unmapped → stop. Behind setting `gusto_agent_fast` (absent = off) until a live test passes. tsc clean.
