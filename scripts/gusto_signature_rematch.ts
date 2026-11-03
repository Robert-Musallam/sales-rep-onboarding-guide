/**
 * Re-match Gusto "can now be paid" notices the watcher left unmatched, using the
 * current matcher (name, then business name).
 *
 *   npx tsx scripts/gusto_signature_rematch.ts            preview only
 *   npx tsx scripts/gusto_signature_rematch.ts --send     write
 *
 * With --send, each newly matched notice is linked to its rep and logged.
 * Only reps still BEFORE contract_signed also get the normal rep.gusto_signed
 * action (ticks the Gusto item, moves the card to Contract Signed, texts ops).
 * Reps already at or past Contract Signed are only linked — no text, no move.
 */
import { db, ONBOARDING, logActivity } from "../worker/db";
import { matchRep } from "../worker/watchers";
import { REP_STATUSES, type RepStatus } from "../modules/reps/types";

async function main() {
  const send = process.argv.includes("--send");
  const { data: events, error } = await db().schema(ONBOARDING).from("gusto_signature_events")
    .select("id, internet_message_id, subject, received_at, gusto_name, gusto_company, note")
    .eq("matched", false).order("received_at", { ascending: true });
  if (error) throw new Error(error.message);
  const { data: reps, error: rErr } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, status, business_name, territory:territories(name)").neq("status", "inactive");
  if (rErr) throw new Error(rErr.message);
  const signedIdx = REP_STATUSES.indexOf("contract_signed" as RepStatus);

  console.log(`${send ? "SEND" : "PREVIEW"} — ${events?.length ?? 0} unmatched notice(s)`);
  for (const e of events ?? []) {
    const { rep, note } = matchRep((reps ?? []) as any, e.gusto_name ?? "", e.gusto_company ?? "");
    const day = String(e.received_at).slice(0, 10);
    if (!rep) { console.log(`- ${day} "${e.subject}" → still unmatched (${note})`); continue; }
    const before = REP_STATUSES.indexOf(rep.status as RepStatus) < signedIdx;
    const action = before ? "link + rep.gusto_signed (Gusto item, Contract Signed, ops text)" : `link only (rep already ${rep.status})`;
    console.log(`- ${day} "${e.subject}" → rep ${rep.id} ${rep.first_name} ${rep.last_name} [${rep.status}] (${note}) → ${action}`);
    if (!send) continue;
    const { error: uErr } = await db().schema(ONBOARDING).from("gusto_signature_events")
      .update({ rep_id: rep.id, matched: true, note: `${note} (re-matched ${new Date().toISOString().slice(0, 10)})` }).eq("id", e.id);
    if (uErr) throw new Error(uErr.message);
    await logActivity(rep.id, "gusto_signature_detected", `Gusto: "${e.subject}" (${note}, re-matched; received ${day})`, { subject: e.subject, received_at: e.received_at });
    if (before) {
      const { error: oErr } = await db().schema(ONBOARDING).from("outbox").upsert(
        { action_type: "rep.gusto_signed", rep_id: rep.id, payload: { gusto_name: e.gusto_name, gusto_company: e.gusto_company, subject: e.subject }, dedupe_key: `gusto_signed:${e.internet_message_id}` },
        { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (oErr) throw new Error(oErr.message);
    }
  }
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
