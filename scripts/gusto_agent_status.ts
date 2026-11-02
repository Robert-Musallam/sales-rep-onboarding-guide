/** Read-only: Gusto agent state — non-legacy reps, recent runs, and rep timelines. */
import { db, ONBOARDING, SHARED } from "../worker/db";
async function main() {
  const { data: reps } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, status, is_test, gusto_agent_status, gusto_agent_note, gusto_agent_at, created_at, territory:territories(name)")
    .or("gusto_agent_status.is.null,gusto_agent_status.neq.legacy").order("created_at", { ascending: false }).limit(15);
  console.log("== reps not marked legacy");
  for (const r of reps ?? []) console.log(JSON.stringify(r));
  const { data: runs } = await db().schema(ONBOARDING).from("gusto_agent_runs").select("*").order("created_at", { ascending: false }).limit(5);
  console.log("== recent agent runs:", runs?.length ?? 0);
  for (const r of runs ?? []) console.log(JSON.stringify({ id: r.id, rep: r.rep_id, mode: r.mode, outcome: r.outcome, stop: r.stop_reason, at: r.created_at }));
  const { data: s } = await db().schema(ONBOARDING).from("app_settings").select("key, value, updated_at").like("key", "gusto_agent_%");
  console.log("== settings"); for (const x of s ?? []) console.log(`${x.key} = ${JSON.stringify(x.value)} (updated ${x.updated_at})`);
  const { data: act } = await db().schema(SHARED).from("entity_activity").select("entity_id, action, summary, created_at")
    .eq("entity_type", "rep").in("entity_id", ["37", "38", "39", "40"]).order("created_at", { ascending: true }).limit(40);
  console.log("== activity reps 37-40"); for (const a of act ?? []) console.log(`${a.created_at} rep ${a.entity_id} ${a.action}: ${String(a.summary).slice(0, 120)}`);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
