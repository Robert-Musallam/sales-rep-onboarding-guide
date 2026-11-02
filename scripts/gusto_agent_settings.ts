/**
 * Show / change the Gusto agent switches in onboarding.app_settings.
 *   npx tsx scripts/gusto_agent_settings.ts                         show
 *   npx tsx scripts/gusto_agent_settings.ts --enabled=true --mode=dry_run --send
 *   npx tsx scripts/gusto_agent_settings.ts "--territories=Arizona,Tampa" --send
 * Writes only with --send.
 */
import { db, ONBOARDING } from "../worker/db";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
async function main() {
  const updates: Record<string, unknown> = {};
  const en = arg("enabled"); if (en) updates.gusto_agent_enabled = en === "true";
  const mode = arg("mode"); if (mode) { if (!["dry_run", "send"].includes(mode)) throw new Error("mode must be dry_run|send"); updates.gusto_agent_mode = mode; }
  const terr = arg("territories");
  if (terr) updates.gusto_agent_territories = terr.split(",").map((t) => t.trim()).filter(Boolean);
  if (Object.keys(updates).length && process.argv.includes("--send")) {
    for (const [key, value] of Object.entries(updates)) {
      const { error } = await db().schema(ONBOARDING).from("app_settings").upsert({ key, value });
      if (error) throw new Error(error.message);
    }
    console.log("updated:", JSON.stringify(updates));
  } else if (Object.keys(updates).length) console.log("DRY RUN — would set", JSON.stringify(updates));
  const { data } = await db().schema(ONBOARDING).from("app_settings").select("key, value").like("key", "gusto_agent_%").order("key");
  for (const r of data ?? []) console.log(`${r.key} = ${JSON.stringify(r.value)}`);
  const { count } = await db().schema(ONBOARDING).from("reps").select("id", { count: "exact", head: true }).eq("gusto_agent_status", "legacy");
  console.log(`reps marked legacy: ${count}`);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
