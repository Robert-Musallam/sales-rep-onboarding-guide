/**
 * Smoke test: Housecall Pro key(s).
 *   npm run verify:hcp -- --territory "Las Vegas"   — key from office_configs
 *   npm run verify:hcp -- --env HCP_API_KEY_TAMPA   — explicit env var
 *   npm run verify:hcp -- --all                     — every active office_configs row
 */
import { listEmployees } from "../worker/connectors/hcp";
import { db } from "../worker/db";

async function main() {
  const argOf = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : null;
  };

  if (process.argv.includes("--all")) {
    const { data } = await db().from("office_configs").select("location_name").eq("is_active", true).order("location_name");
    for (const row of data ?? []) {
      try {
        const n = await listEmployees({ territoryName: row.location_name });
        console.log(`✅ ${row.location_name}: ${n} employees visible`);
      } catch (e) {
        console.log(`❌ ${row.location_name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return;
  }

  const count = await listEmployees({ apiKeyEnv: argOf("env"), territoryName: argOf("territory") });
  console.log(`✅ HCP key OK: ${count} employees visible`);
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
