/**
 * Re-arm one rep for the Gusto agent (e.g. after a dry run, to go live).
 *   npx tsx scripts/gusto_agent_rearm.ts <rep_id>          (dry run)
 *   npx tsx scripts/gusto_agent_rearm.ts <rep_id> --send
 * Sets gusto_agent_status=queued and puts its outbox row back to pending now.
 * Refuses reps whose status is 'added' or 'in_progress' (would double-invite).
 */
import { db, ONBOARDING, logActivity } from "../worker/db";
async function main() {
  const id = Number(process.argv[2]);
  if (!id) throw new Error("rep id required");
  const { data: rep } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, status, gusto_agent_status").eq("id", id).maybeSingle();
  if (!rep) throw new Error(`rep ${id} not found`);
  console.log(`rep #${rep.id} ${rep.first_name} ${rep.last_name} status=${rep.status} gusto_agent_status=${rep.gusto_agent_status}`);
  if (["added", "in_progress"].includes(rep.gusto_agent_status ?? "")) throw new Error(`refusing: gusto_agent_status=${rep.gusto_agent_status}`);
  if (!process.argv.includes("--send")) { console.log("DRY RUN — would set queued + outbox pending now"); return; }
  await db().schema(ONBOARDING).from("reps").update({ gusto_agent_status: "queued", gusto_agent_note: "re-armed" }).eq("id", id);
  const { data: ob } = await db().schema(ONBOARDING).from("outbox")
    .update({ state: "pending", run_after: new Date().toISOString(), last_error: null })
    .eq("dedupe_key", `gusto.add_contractor:${id}`).select("id");
  if (!ob?.length) {
    await db().schema(ONBOARDING).from("outbox").insert({ action_type: "gusto.add_contractor", rep_id: id, payload: {}, dedupe_key: `gusto.add_contractor:${id}` });
  }
  await logActivity(id, "gusto_agent_rearmed", "Gusto agent: re-armed by Robert");
  console.log(`✅ re-armed rep #${id}`);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
