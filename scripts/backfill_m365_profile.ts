/**
 * Backfill an existing rep's Microsoft directory record.
 *
 * Reps provisioned before 2026-08-24 got `initial+lastname` as their display
 * name and no contact card at all — the worker only learned to fill those in
 * on that date, and it only does so at creation time. This re-applies the same
 * rules to reps that already exist.
 *
 * Deliberately does NOT touch passwords: by the time anyone runs this the rep
 * may already have signed in and set their own.
 *
 *   npx tsx -r dotenv/config scripts/backfill_m365_profile.ts 8 9          # preview
 *   npx tsx -r dotenv/config scripts/backfill_m365_profile.ts 8 9 --apply  # write
 */
import { contactInfo, type Rep } from "../worker/actions";
import * as graph from "../worker/connectors/graph";
import { db, ONBOARDING } from "../worker/db";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ids = args.filter((a) => !a.startsWith("--")).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) throw new Error("usage: backfill_m365_profile.ts <repId...> [--apply]");

  const { data, error } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .select("*, territory:territories(name, post_sales_chat_ids, hcp_api_key_env)")
    .in("id", ids);
  if (error) throw new Error(`load reps: ${error.message}`);

  for (const row of data ?? []) {
    const rep = row as unknown as Rep;
    if (!rep.m365_user_id) {
      console.log(`rep ${rep.id} ${rep.first_name} ${rep.last_name}: no m365_user_id — skipped`);
      continue;
    }
    const displayName = `${rep.first_name} ${rep.last_name}`;
    const contact = await contactInfo(rep);
    const before = await graph.getUserProfile(rep.m365_user_id);

    console.log(`\n── rep ${rep.id} · ${rep.rnb_email} ──`);
    console.log("  before:", JSON.stringify(before));
    console.log("  after :", JSON.stringify({ displayName, ...contact }));

    if (!apply) continue;
    await graph.updateUser(rep.m365_user_id, { displayName, contact });
    console.log("  ✓ patched");
  }
  console.log(apply ? "\nDone." : "\nPreview only — pass --apply to write.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
