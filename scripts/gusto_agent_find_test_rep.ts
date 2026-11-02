/** Read-only: list reps that look like the Gusto-agent test rep. */
import { db, ONBOARDING } from "../worker/db";
async function main() {
  const { data, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, status, is_test, created_at")
    .or("last_name.ilike.%test%,personal_email.ilike.%josebrest%,first_name.ilike.%test%")
    .order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) console.log(`#${r.id} | ${r.first_name} | ${r.last_name} | ${r.personal_email} | ${r.status} | is_test=${r.is_test} | ${r.created_at}`);
  if (!data?.length) console.log("none");
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
