/**
 * Called by m365-run.sh at the end of a worker-started run (M365_REP_ID set).
 * Writes the outcome to onboarding.reps, logs the rep timeline, alerts on
 * anything that is not a clean result, and re-queues runs that only need to wait.
 *
 *   npx tsx gusto-agent/m365-record.ts <rep_id> <dry_run|send> <out.json>
 */
import { readFileSync } from "node:fs";
import { db, ONBOARDING, logActivity } from "../worker/db";
import { alert } from "../worker/alert";

type R = { outcome?: string; reason?: string | null; available?: string; licenses_after?: string[]; launcher_exit?: number };

async function setStatus(repId: number, status: string, note: string) {
  await db().schema(ONBOARDING).from("reps")
    .update({ m365_agent_status: status, m365_agent_note: note.slice(0, 500), m365_agent_at: new Date().toISOString() })
    .eq("id", repId);
}

async function main() {
  const [repIdS, mode, outPath] = process.argv.slice(2);
  const repId = Number(repIdS);
  if (!repId || !outPath) throw new Error("usage: m365-record.ts <rep_id> <mode> <out.json>");
  const { data: rep } = await db().schema(ONBOARDING).from("reps").select("first_name, last_name, rnb_email").eq("id", repId).maybeSingle();
  const who = rep ? `${rep.first_name} ${rep.last_name} (${rep.rnb_email ?? "no RNB email"})` : `rep ${repId}`;

  let r: R = {};
  try {
    const lines = readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean);
    r = JSON.parse(lines[lines.length - 1]);
  } catch { /* empty / partial */ }

  if (r.outcome === "deferred") {
    await setStatus(repId, "queued", `deferred (launcher exit ${r.launcher_exit}) — retry in 5 min`);
    await db().schema(ONBOARDING).from("outbox")
      .update({ state: "pending", run_after: new Date(Date.now() + 5 * 60_000).toISOString() })
      .eq("dedupe_key", `m365.assign_license:${repId}`);
    await logActivity(repId, "m365_agent_waiting", "M365 agent: browser busy (AppFolio or memory) — retry in 5 min");
    return;
  }

  let status: string;
  let note: string;
  switch (r.outcome) {
    case "licensed":
    case "already_licensed":
      status = mode === "send" ? "licensed" : "dry_run_ok";
      note = `${r.outcome === "already_licensed" ? "Business Basic was already assigned" : "Business Basic assigned"} · ${r.available ?? ""}`;
      break;
    case "dry_run_ok":
      status = "dry_run_ok"; note = `user found, license available (${r.available ?? "?"}) — nothing saved`;
      break;
    case "session":
      status = "stopped"; note = "Microsoft sign-in needed in the Gusto agent's Chrome — sign in, then re-arm";
      break;
    case "stopped":
      status = "stopped"; note = r.reason ?? "stopped";
      break;
    default:
      status = "needs_review"; note = `no parsable result (${r.outcome ?? "empty"})`;
  }
  await setStatus(repId, status, note);
  await logActivity(repId, `m365_agent_${status}`, `M365 agent (${mode}): ${status} — ${note}`.slice(0, 300));
  if (status !== "licensed" && status !== "dry_run_ok") {
    await alert(`M365 agent: ${status}`, `${who}: ${note}`);
  }
  // Seat warning: after a save, flag when Business Basic is running out.
  const m = (r.available ?? "").match(/(\d+)\s+of/);
  if (status === "licensed" && m && Number(m[1]) <= 1) {
    await alert("M365: Business Basic almost out", `${m[1]} Business Basic license(s) left (${r.available}). Buying more needs your approval.`);
  }
}

main().catch(async (e) => {
  console.error("m365-record failed:", e?.message ?? e);
  await alert("M365 agent: could not record result", String(e?.message ?? e)).catch(() => {});
  process.exit(1);
});
