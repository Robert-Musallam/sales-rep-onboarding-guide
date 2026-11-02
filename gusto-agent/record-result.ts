/**
 * Called by run.sh at the end of a worker-started run (GUSTO_REP_ID set).
 * Writes the outcome to onboarding.reps + onboarding.gusto_agent_runs, logs the
 * rep timeline, alerts on anything that is not a clean result, and re-queues
 * runs that only need to wait (AppFolio busy, low memory, SMS code pending).
 *
 *   npx tsx gusto-agent/record-result.ts <rep_id> <dry_run|send> <out.json>
 */
import { readFileSync } from "node:fs";
import { db, ONBOARDING, logActivity } from "../worker/db";
import { alert } from "../worker/alert";

type SkillResult = {
  outcome?: string; stop_reason?: string | null; gusto_company?: string | null;
  invite_sent?: boolean; documents?: string[]; notes?: string;
};

// login.js / launcher codes that only mean "try again later"
const RETRY_LOGIN = new Set([10, 13, 14, 16]);
const RETRY_MIN = 15;

function lastJsonObject(text: string): SkillResult | null {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced : [text.slice(text.lastIndexOf("{"))];
  for (const c of candidates.reverse()) {
    try { return JSON.parse(c) as SkillResult; } catch { /* next */ }
  }
  return null;
}

async function requeue(repId: number, why: string, minutes = RETRY_MIN) {
  await db().schema(ONBOARDING).from("reps").update({ gusto_agent_status: "queued", gusto_agent_note: why }).eq("id", repId);
  await db().schema(ONBOARDING).from("outbox")
    .update({ state: "pending", run_after: new Date(Date.now() + minutes * 60_000).toISOString() })
    .eq("dedupe_key", `gusto.add_contractor:${repId}`);
  await logActivity(repId, "gusto_agent_waiting", `Gusto agent: ${why} — retry in ${minutes} min`);
}

async function main() {
  const [repIdS, mode, outPath] = process.argv.slice(2);
  const repId = Number(repIdS);
  if (!repId || !outPath) throw new Error("usage: record-result.ts <rep_id> <mode> <out.json>");
  const { data: rep } = await db().schema(ONBOARDING).from("reps")
    .select("first_name, last_name").eq("id", repId).maybeSingle();
  const who = rep ? `${rep.first_name} ${rep.last_name}` : `rep ${repId}`;

  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(readFileSync(outPath, "utf8")); } catch { /* empty / partial */ }

  // run.sh's own outcomes: launcher deferred or sign-in step
  if (raw.outcome === "deferred") return requeue(repId, `deferred (launcher exit ${raw.launcher_exit})`, 5);
  if (raw.outcome === "session") {
    const code = Number(raw.login_exit);
    if (RETRY_LOGIN.has(code)) return requeue(repId, `Gusto sign-in waiting (login exit ${code})`);
    await db().schema(ONBOARDING).from("reps").update({ gusto_agent_status: "stopped", gusto_agent_note: `sign-in failed (login exit ${code})` }).eq("id", repId);
    await db().schema(ONBOARDING).from("gusto_agent_runs").insert({ rep_id: repId, mode, outcome: "session", stop_reason: `login_exit_${code}`, result: raw });
    await alert("Gusto agent: sign-in failed", `${who}: sign-in step failed (exit ${code}). Check the Keychain item gusto-agent.`);
    return;
  }

  const result = lastJsonObject(String(raw.result ?? ""));
  const cost = typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : null;
  const duration = typeof raw.duration_ms === "number" ? raw.duration_ms : null;

  let status: string;
  let note: string;
  if (!result) {
    status = "needs_review"; note = `no parsable result (claude ${raw.subtype ?? "error"})`;
  } else if (result.invite_sent && result.outcome !== "added") {
    status = "needs_review"; note = `invite SENT but run ended '${result.outcome}' (${result.stop_reason ?? "no reason"}) — finish in Gusto`;
  } else if (result.outcome === "added" || result.outcome === "dry_run_ok") {
    status = result.outcome; note = `${result.gusto_company ?? ""}${result.documents?.length ? ` · docs: ${result.documents.join(", ")}` : ""}`;
  } else if (result.outcome === "stopped") {
    status = "stopped"; note = result.stop_reason ?? "stopped";
  } else {
    status = "needs_review"; note = `unexpected outcome '${result.outcome}'`;
  }

  await db().schema(ONBOARDING).from("reps").update({
    gusto_agent_status: status, gusto_agent_note: note.slice(0, 500),
    gusto_agent_company: result?.gusto_company ?? null, gusto_agent_at: new Date().toISOString(),
  }).eq("id", repId);
  await db().schema(ONBOARDING).from("gusto_agent_runs").insert({
    rep_id: repId, mode, outcome: result?.outcome ?? "needs_review", stop_reason: result?.stop_reason ?? null,
    gusto_company: result?.gusto_company ?? null, invite_sent: !!result?.invite_sent,
    documents: result?.documents ?? [], cost_usd: cost, duration_ms: duration, result: result ?? { raw_subtype: raw.subtype ?? null },
  });
  await logActivity(repId, `gusto_agent_${status}`, `Gusto agent (${mode}): ${status} — ${note}`.slice(0, 300));
  if (status !== "added" && status !== "dry_run_ok") {
    await alert(`Gusto agent: ${status}`, `${who}: ${note}`);
  }
}

main().catch(async (e) => {
  console.error("record-result failed:", e?.message ?? e);
  await alert("Gusto agent: could not record result", String(e?.message ?? e)).catch(() => {});
  process.exit(1);
});
