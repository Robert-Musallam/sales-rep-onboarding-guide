import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { postMonitor } from "./monitor-post";

/**
 * One place for "what did the browser agent really do": the Gusto, HCP and M365 result
 * recorders (gusto-agent/*-record.ts) call reportAgentRun() when a run ends.
 *
 *  - Always appends ONE line with the real result (outcome, status, invite_sent, stop_reason)
 *    to worker/logs/worker.log. The outbox row for the action says DONE as soon as run.sh is
 *    started; this line is what says how the run actually ended.
 *  - When the run needs a person (anything but a clean result), also posts to #monitor with the
 *    rep id and the reason. No names, emails or phone numbers.
 *
 * It never throws: reporting must not break the recorder. It does not touch the outbox, the
 * dedupe keys or any retry logic.
 */
export type AgentRun = {
  agent: "gusto" | "hcp" | "m365";
  repId: number;
  mode: string;
  outcome: string;
  status: string;
  inviteSent?: boolean | null;
  stopReason?: string | null;
  note?: string | null;
  /** Statuses that are an expected end state and need nobody (e.g. a rep already Active in Gusto). */
  benign?: boolean;
};

const CLEAN = new Set(["added", "dry_run_ok", "created", "licensed"]);
const LOG_FILE = path.join(__dirname, "logs", "worker.log");

/** Drop anything that looks like an email address or a phone number. */
export function scrub(text: string): string {
  return String(text ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "<number>" : m))
    .replace(/\s+/g, " ")
    .trim();
}

export function needsAttention(r: AgentRun): boolean {
  return !CLEAN.has(r.status) && !r.benign;
}

export function formatLogLine(r: AgentRun): string {
  const parts = [
    `[agent-result] ${r.agent} rep=${r.repId} mode=${r.mode}`,
    `outcome=${r.outcome}`,
    `status=${r.status}`,
    `invite_sent=${r.inviteSent == null ? "n/a" : r.inviteSent}`,
    `stop_reason=${scrub(r.stopReason ?? "") || "none"}`,
  ];
  return parts.join(" ");
}

export function formatMonitorText(r: AgentRun): string {
  const lines = [
    `:warning: *RNB onboarding — ${r.agent} agent needs a person* (rep_id ${r.repId})`,
    `• outcome: ${r.outcome} · status: ${r.status}${r.inviteSent == null ? "" : ` · invite_sent: ${r.inviteSent}`}`,
    `• reason: ${scrub(r.stopReason ?? r.note ?? "") || "no reason given"}`,
  ];
  if (r.inviteSent === true) lines.push("• the invitation HAS been sent: do not send another; finish the remaining steps by hand.");
  if (r.outcome === "not_started") lines.push("• nothing was sent: bring the agents' Chrome window to the front, then re-arm the rep.");
  return lines.join("\n");
}

export async function reportAgentRun(r: AgentRun): Promise<string> {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, formatLogLine(r) + "\n");
  } catch { /* best effort */ }
  if (!needsAttention(r)) return "logged";
  try {
    return `logged · ${await postMonitor(formatMonitorText(r))}`;
  } catch (e) {
    return `logged · #monitor failed (${String((e as Error).message ?? e).slice(0, 80)})`;
  }
}
