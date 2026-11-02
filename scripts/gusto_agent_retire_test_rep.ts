/**
 * Retire the Gusto-agent test rep "Robert Test" (josebrest25@gmail.com) from Holding OS.
 * Reversible on purpose: status -> inactive, is_test -> true, pending outbox rows -> skipped.
 * Nothing is deleted. Dry run by default; writes only with --send.
 *
 *   npx tsx scripts/gusto_agent_retire_test_rep.ts          (dry run)
 *   npx tsx scripts/gusto_agent_retire_test_rep.ts --send
 */
import { db, ONBOARDING, logActivity } from "../worker/db";

const SEND = process.argv.includes("--send");

async function main() {
  const { data: reps, error } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .select("id, first_name, last_name, personal_email, status, is_test")
    .ilike("first_name", "robert")
    .ilike("last_name", "test")
    .ilike("personal_email", "josebrest25@gmail.com");
  if (error) throw new Error(error.message);
  if (!reps?.length) { console.log("no matching rep — nothing to do"); return; }
  if (reps.length > 1) throw new Error(`expected 1 rep, found ${reps.length}: ${reps.map((r) => r.id).join(", ")}`);
  const rep = reps[0];

  const { data: pending } = await db().schema(ONBOARDING).from("outbox")
    .select("id, action_type").eq("rep_id", rep.id).eq("state", "pending");

  console.log(`rep #${rep.id} ${rep.first_name} ${rep.last_name} <${rep.personal_email}> status=${rep.status} is_test=${rep.is_test}`);
  console.log(`pending outbox rows: ${(pending ?? []).map((p) => `${p.id}:${p.action_type}`).join(", ") || "none"}`);
  if (!SEND) { console.log("DRY RUN — would set status=inactive, is_test=true, skip pending outbox rows. Re-run with --send."); return; }

  await db().schema(ONBOARDING).from("reps").update({ status: "inactive", is_test: true }).eq("id", rep.id);
  if (pending?.length) {
    await db().schema(ONBOARDING).from("outbox")
      .update({ state: "skipped", dry_run_log: { note: "retired Gusto-agent test rep" } })
      .eq("rep_id", rep.id).eq("state", "pending");
  }
  await logActivity(rep.id, "test_rep_retired", "Gusto agent test rep retired (status inactive, is_test true) — 2026-10-30");
  console.log(`✅ rep #${rep.id} retired: status=inactive, is_test=true, ${pending?.length ?? 0} pending outbox row(s) skipped`);
}

main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
