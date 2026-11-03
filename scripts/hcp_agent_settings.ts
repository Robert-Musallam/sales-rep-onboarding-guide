/**
 * Show / change the HCP user agent switches in onboarding.app_settings.
 *   npx tsx scripts/hcp_agent_settings.ts                                    show
 *   npx tsx scripts/hcp_agent_settings.ts --enabled=true --mode=dry_run --send
 *   npx tsx scripts/hcp_agent_settings.ts "--territories=Arizona,Tampa" --send
 *   npx tsx scripts/hcp_agent_settings.ts --rearm=38 --send                  set one rep back to null (re-run)
 *   npx tsx scripts/hcp_agent_settings.ts --park=38 --send                   mark one rep 'legacy' (never picked up)
 *   npx tsx scripts/hcp_agent_settings.ts --queue=38 --send                  queue one rep for a run now (skips the welcome check; uses the current mode)
 * Writes only with --send.
 */
import { db, ONBOARDING } from "../worker/db";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
async function main() {
  const send = process.argv.includes("--send");
  const updates: Record<string, unknown> = {};
  const en = arg("enabled"); if (en) updates.hcp_agent_enabled = en === "true";
  const mode = arg("mode"); if (mode) { if (!["dry_run", "send"].includes(mode)) throw new Error("mode must be dry_run|send"); updates.hcp_agent_mode = mode; }
  const terr = arg("territories"); if (terr) updates.hcp_agent_territories = terr.split(",").map((t) => t.trim()).filter(Boolean);
  if (Object.keys(updates).length && send) {
    for (const [key, value] of Object.entries(updates)) {
      const { error } = await db().schema(ONBOARDING).from("app_settings").upsert({ key, value });
      if (error) throw new Error(error.message);
    }
    console.log("updated:", JSON.stringify(updates));
  } else if (Object.keys(updates).length) console.log("DRY RUN — would set", JSON.stringify(updates));
  const rearm = Number(arg("rearm") ?? 0);
  if (rearm) {
    if (send) {
      await db().schema(ONBOARDING).from("reps").update({ hcp_agent_status: null, hcp_agent_note: "re-armed" }).eq("id", rearm);
      await db().schema(ONBOARDING).from("outbox").delete().in("dedupe_key", [`hcp.create_user:${rearm}`, `hcp.check_user:${rearm}`]);
      console.log(`re-armed rep ${rearm}`);
    } else console.log(`DRY RUN — would re-arm rep ${rearm}`);
  }
  const queue = Number(arg("queue") ?? 0);
  if (queue) {
    if (send) {
      await db().schema(ONBOARDING).from("outbox").delete().in("dedupe_key", [`hcp.create_user:${queue}`, `hcp.check_user:${queue}`]);
      await db().schema(ONBOARDING).from("reps").update({ hcp_agent_status: "queued", hcp_agent_note: "queued by hand", hcp_agent_at: new Date().toISOString() }).eq("id", queue);
      const { error } = await db().schema(ONBOARDING).from("outbox").insert({ action_type: "hcp.create_user", rep_id: queue, payload: {}, dedupe_key: `hcp.create_user:${queue}` });
      if (error) throw new Error(error.message);
      console.log(`queued rep ${queue} — the worker picks it up within a minute`);
    } else console.log(`DRY RUN — would queue rep ${queue}`);
  }
  const park = Number(arg("park") ?? 0);
  if (park) {
    if (send) {
      await db().schema(ONBOARDING).from("reps").update({ hcp_agent_status: "legacy", hcp_agent_note: "parked by hand" }).eq("id", park);
      console.log(`parked rep ${park}`);
    } else console.log(`DRY RUN — would park rep ${park}`);
  }
  const { data } = await db().schema(ONBOARDING).from("app_settings").select("key, value").like("key", "hcp_agent_%").order("key");
  for (const r of data ?? []) console.log(`${r.key} = ${JSON.stringify(r.value)}`);
  const { data: reps } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, status, hcp_agent_status, hcp_agent_note, hcp_agent_at")
    .not("hcp_agent_status", "is", null).neq("hcp_agent_status", "legacy").order("hcp_agent_at", { ascending: false }).limit(10);
  console.log("== reps seen by the HCP agent");
  for (const r of reps ?? []) console.log(JSON.stringify(r));
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
