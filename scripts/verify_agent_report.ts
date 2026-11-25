/**
 * Offline checks for worker/agent-report.ts (no network, no database, no Slack).
 *   npx tsx scripts/verify_agent_report.ts
 */
import assert from "node:assert/strict";
import { scrub, needsAttention, formatLogLine, formatMonitorText, type AgentRun } from "../worker/agent-report";

const base: AgentRun = { agent: "gusto", repId: 41, mode: "send", outcome: "stopped", status: "needs_review", inviteSent: true, stopReason: "contractor_agreement_unclear:Florida sales" };

// scrub removes emails and phone numbers
assert.equal(scrub("write to jane.doe@example.com or +1 (321) 427-0848 now"), "write to <email> or <number> now");
assert.equal(scrub("rep_id 41 and 2026-11-25"), "rep_id 41 and 2026-11-25");

// who needs a person
assert.equal(needsAttention(base), true);
assert.equal(needsAttention({ ...base, status: "added", outcome: "added" }), false);
assert.equal(needsAttention({ ...base, status: "created", outcome: "created" }), false);
assert.equal(needsAttention({ ...base, status: "dry_run_ok", outcome: "dry_run_ok" }), false);
assert.equal(needsAttention({ ...base, status: "stopped", benign: true }), false);
assert.equal(needsAttention({ ...base, status: "stopped", outcome: "not_started", inviteSent: false }), true);

// the log line carries the real result
const line = formatLogLine(base);
assert.match(line, /^\[agent-result\] gusto rep=41 mode=send outcome=stopped status=needs_review invite_sent=true stop_reason=contractor_agreement_unclear:Florida sales$/);
assert.match(formatLogLine({ ...base, inviteSent: null, stopReason: null }), /invite_sent=n\/a stop_reason=none$/);

// the #monitor text has rep id and reason, and no personal data even if the note has some
const text = formatMonitorText({ ...base, stopReason: null, note: "see jane@example.com or 3214270848" });
assert.match(text, /rep_id 41/);
assert.match(text, /reason: see <email> or <number>/);
assert.doesNotMatch(text, /@example|3214270848/);
assert.match(text, /invitation HAS been sent/);
const ns = formatMonitorText({ ...base, outcome: "not_started", status: "needs_review", inviteSent: false, stopReason: "browser_window_hidden" });
assert.match(ns, /nothing was sent/);
assert.doesNotMatch(ns, /invitation HAS been sent/);

console.log("verify_agent_report: all checks passed");
