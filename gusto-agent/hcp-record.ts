/**
 * Called by hcp-run.sh at the end of a worker-started run (HCP_REP_ID set).
 * Writes the outcome to onboarding.reps, logs the rep timeline, alerts on
 * anything that is not a clean result, re-queues runs that only need to wait,
 * and — when HCP asked to pay for another user — messages Robert in Teams.
 *
 *   npx tsx gusto-agent/hcp-record.ts <rep_id> <dry_run|send> <out.json>
 */
import { readFileSync } from "node:fs";
import { db, ONBOARDING, getSetting, logActivity } from "../worker/db";
import { alert } from "../worker/alert";
import * as graph from "../worker/connectors/graph";

type R = { outcome?: string; reason?: string | null; account?: string; color?: string; launcher_exit?: number };

async function setStatus(repId: number, status: string, note: string) {
  await db().schema(ONBOARDING).from("reps")
    .update({ hcp_agent_status: status, hcp_agent_note: note.slice(0, 500), hcp_agent_at: new Date().toISOString() })
    .eq("id", repId);
}

/** Robert's standing rule (2026-11-03): a pay-for-another-user prompt → Teams message to him. */
async function notifyPayment(account: string, who: string): Promise<string> {
  const to = ((await getSetting<string>("hcp_agent_payment_notify_upn")) ?? "").trim();
  const from = ((await getSetting<string>("admin_upn")) ?? "").trim();
  const text = `Need an additional Housecall Pro user authorized in ${account} before onboarding can continue for ${who}.`;
  if (!to || !from) return "no notify address configured";
  try {
    const chatId = await graph.createOneOnOneChat(from, to);
    await graph.sendChatMessage(chatId, text);
    return `Teams message sent to ${to}`;
  } catch (e) {
    return `Teams message to ${to} failed: ${String((e as Error).message ?? e).slice(0, 160)}`;
  }
}

async function main() {
  const [repIdS, mode, outPath] = process.argv.slice(2);
  const repId = Number(repIdS);
  if (!repId || !outPath) throw new Error("usage: hcp-record.ts <rep_id> <mode> <out.json>");
  const { data: rep } = await db().schema(ONBOARDING).from("reps").select("first_name, last_name, rnb_email").eq("id", repId).maybeSingle();
  const name = rep ? `${rep.first_name} ${rep.last_name}` : `rep ${repId}`;

  let r: R = {};
  try {
    const lines = readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean);
    r = JSON.parse(lines[lines.length - 1]);
  } catch { /* empty / partial */ }

  if (r.outcome === "deferred") {
    await setStatus(repId, "queued", `deferred (launcher exit ${r.launcher_exit}) — retry in 5 min`);
    await db().schema(ONBOARDING).from("outbox")
      .update({ state: "pending", run_after: new Date(Date.now() + 5 * 60_000).toISOString() })
      .eq("dedupe_key", `hcp.create_user:${repId}`);
    await logActivity(repId, "hcp_agent_waiting", "HCP agent: browser busy (AppFolio or memory) — retry in 5 min");
    return;
  }

  let status: string;
  let note: string;
  switch (r.outcome) {
    case "created":
      status = "created"; note = `added to ${r.account} as Field Tech (customer database off) · invite sent`; break;
    case "dry_run_ok":
      status = "dry_run_ok"; note = `form filled for ${r.account} and read back — nothing saved`; break;
    case "duplicate":
      status = "stopped"; note = `already in HCP: ${r.reason}`; break;
    case "payment_required": {
      const sent = await notifyPayment(r.account ?? "the territory account", name);
      status = "stopped"; note = `HCP asked to pay for another user in ${r.account} — cancelled, nothing authorized · ${sent}`; break;
    }
    case "session":
      status = "stopped"; note = "Housecall Pro sign-in needed in the Gusto agent's Chrome — sign in, then re-arm"; break;
    case "stopped":
      status = "stopped"; note = r.reason ?? "stopped"; break;
    default:
      status = "needs_review"; note = `no parsable result (${r.outcome ?? "empty"}) — check HCP before re-arming`;
  }
  await setStatus(repId, status, note);
  await logActivity(repId, `hcp_agent_${status}`, `HCP agent (${mode}): ${status} — ${note}`.slice(0, 300));
  if (status !== "created" && status !== "dry_run_ok") await alert(`HCP agent: ${status}`, `${name}: ${note}`);
}

main().catch(async (e) => {
  console.error("hcp-record failed:", e?.message ?? e);
  await alert("HCP agent: could not record result", String(e?.message ?? e)).catch(() => {});
  process.exit(1);
});
