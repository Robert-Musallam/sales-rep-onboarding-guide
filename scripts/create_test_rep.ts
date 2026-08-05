/**
 * Create an end-to-end TEST rep (is_test=true) with a full checklist and the
 * intake bundle queued — the Phase-6 dry-run fixture. Point the phone/email at
 * yourself so pilot-mode sends reach only you.
 *
 *   npm run test:rep -- --phone 7025550123 --email robert@example.com
 */
import { db, ONBOARDING, logActivity } from "../worker/db";
import { outboxRowsFor } from "../lib/onboarding/automations";

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : null;
  };
  const phone = arg("phone");
  const email = arg("email");
  if (!phone) throw new Error("--phone is required (your own cell, 10 digits)");

  const { data: territory } = await db().schema(ONBOARDING).from("territories").select("id, name").eq("name", "Las Vegas").maybeSingle();

  const { data: rep, error } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .insert({
      first_name: "Test",
      last_name: `Rep${Date.now() % 10000}`,
      phone_e164: `+1${phone.replace(/\D/g, "").slice(-10)}`,
      personal_email: email,
      phone_os: "iOS",
      manager_name: "E2E Harness",
      territory_id: territory?.id ?? null,
      is_test: true,
    })
    .select("id, first_name, last_name")
    .single();
  if (error) throw new Error(error.message);

  const { data: templates } = await db()
    .schema(ONBOARDING)
    .from("checklist_templates")
    .select("key, label, sort_order, automation_key")
    .eq("active", true)
    .order("sort_order");
  await db()
    .schema(ONBOARDING)
    .from("checklist_items")
    .insert(
      (templates ?? []).map((t) => ({
        rep_id: rep.id,
        template_key: t.key,
        label: t.label,
        sort_order: t.sort_order,
        automation_key: t.automation_key,
      })),
    );

  await db()
    .schema(ONBOARDING)
    .from("outbox")
    .upsert(outboxRowsFor("intake_submitted", rep.id), { onConflict: "dedupe_key", ignoreDuplicates: true });

  await logActivity(rep.id, "rep_created", "Test rep created by create_test_rep.ts");
  console.log(`✅ created TEST rep #${rep.id} (${rep.first_name} ${rep.last_name}) with checklist + invite queued`);
  console.log("   Watch it in the webapp (/reps) and run the worker: npm run worker:once");
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
