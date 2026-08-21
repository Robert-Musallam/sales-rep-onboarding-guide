import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { db, ONBOARDING } from "./db";
import { getHandler } from "./actions";
import { sweepInfoFormReminders } from "./sweeps";
import { alert } from "./alert";

/**
 * Outbox executor. Invoked by launchd every 60s (ops/com.rnb.onboarding-worker.plist)
 * as a single pass: claim due pending actions → dispatch → done/skipped/failed.
 *
 * Retry: on throw, the row goes back to pending with exponential run_after
 * backoff; after MAX_ATTEMPTS it lands in `failed` and fires one alert. Failed
 * rows are retriable from the rep drawer (state reset to pending).
 *
 * Gate outcomes (dry-run / pilot blocks) are `skipped` — deliberate no-sends,
 * visible in the drawer with a preview of what WOULD have gone out.
 */
const MAX_ATTEMPTS = 5;
const BATCH = 20;
const LOCK = path.join(__dirname, ".worker.lock");

function acquireLock(): boolean {
  try {
    if (existsSync(LOCK)) {
      // stale-break after 15 min (a wedged pass never blocks the queue forever)
      const age = Date.now() - statSync(LOCK).mtimeMs;
      if (age < 15 * 60_000) return false;
      rmSync(LOCK, { force: true });
    }
    mkdirSync(path.dirname(LOCK), { recursive: true });
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

async function pass(): Promise<void> {
  if (process.env.RNB_GLOBAL_KILL_SWITCH === "1") {
    console.log("kill switch on — leaving queue untouched");
    return;
  }
  // Time-based enqueues run first so anything they schedule for "now" is picked
  // up by this same pass. A sweep failure must never stall the queue.
  try {
    await sweepInfoFormReminders();
  } catch (e) {
    console.error("info-form reminder sweep failed:", e instanceof Error ? e.message : String(e));
  }
  const { data: rows, error } = await db()
    .schema(ONBOARDING)
    .from("outbox")
    .select("id, action_type, rep_id, payload, attempts")
    .eq("state", "pending")
    .lte("run_after", new Date().toISOString())
    .order("run_after", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`outbox fetch: ${error.message}`);
  if (!rows?.length) return;

  for (const row of rows) {
    // claim (state guard makes concurrent passes safe)
    const { data: claimed } = await db()
      .schema(ONBOARDING)
      .from("outbox")
      .update({ state: "in_flight", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("state", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const label = `[${row.id}] ${row.action_type} rep=${row.rep_id}`;
    const handler = getHandler(row.action_type);
    try {
      if (!handler) throw new Error(`no handler for action_type ${row.action_type}`);
      const result = await handler(row.rep_id as number, (row.payload ?? {}) as Record<string, unknown>);
      if ("skipped" in result) {
        await db()
          .schema(ONBOARDING)
          .from("outbox")
          .update({
            state: "skipped",
            executed_at: new Date().toISOString(),
            dry_run_log: { note: result.note },
          })
          .eq("id", row.id);
        console.log(`${label} SKIPPED: ${result.note}`);
      } else {
        await db()
          .schema(ONBOARDING)
          .from("outbox")
          .update({
            state: "done",
            executed_at: new Date().toISOString(),
            last_error: null,
            // Receipt (e.g. "→ +1408… · dialpad id 123 · status pending") —
            // surfaces in the drawer's Automations list.
            dry_run_log: result.note ? { note: result.note } : null,
          })
          .eq("id", row.id);
        console.log(`${label} DONE${result.note ? `: ${result.note}` : ""}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = row.attempts + 1;
      const permanent = msg.startsWith("PERMANENT: ");
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await db()
          .schema(ONBOARDING)
          .from("outbox")
          .update({ state: "failed", last_error: msg, executed_at: new Date().toISOString() })
          .eq("id", row.id);
        console.error(`${label} FAILED (final): ${msg}`);
        await alert(`outbox action failed: ${row.action_type}`, `rep=${row.rep_id} outbox_id=${row.id}\n${msg}`);
      } else {
        const backoffMin = 2 ** attempts; // 2, 4, 8, 16 min
        await db()
          .schema(ONBOARDING)
          .from("outbox")
          .update({
            state: "pending",
            last_error: msg,
            run_after: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          })
          .eq("id", row.id);
        console.warn(`${label} retry in ${backoffMin}m: ${msg}`);
      }
    }
  }
}

async function main() {
  if (!acquireLock()) {
    console.log("another worker pass is running — exiting");
    return;
  }
  try {
    await pass();
  } finally {
    rmSync(LOCK, { force: true });
  }
}

main().catch(async (e) => {
  console.error("worker pass crashed:", e);
  await alert("worker pass crashed", e instanceof Error ? e.message : String(e));
  rmSync(LOCK, { force: true });
  process.exit(1);
});
