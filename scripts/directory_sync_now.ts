/**
 * Run the hourly Company Directory pass right now (workbook → Academy mirror →
 * Settings → People), ignoring the one-hour gate. Prints the same one-line
 * receipt the worker logs.
 *
 *   npx tsx scripts/directory_sync_now.ts
 */
import { syncCompanyDirectory } from "../worker/directory-sync";

syncCompanyDirectory({ force: true })
  .then((receipt) => {
    console.log(receipt ?? "directory sync skipped (Academy not configured)");
    process.exit(0);
  })
  .catch((e) => {
    console.error("directory sync failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
