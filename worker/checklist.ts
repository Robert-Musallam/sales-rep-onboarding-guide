import { db, ONBOARDING } from "./db";
import { outboxRowsFor, STATUS_ON_COMPLETE } from "../lib/onboarding/automations";
import { REP_STATUSES, type RepStatus } from "../modules/reps/types";

/*
 * Checklist completion shared by the outbox handlers (worker/actions.ts) and
 * the agents' result recorders (gusto-agent/record-result.ts). Kept apart from
 * actions.ts so a recorder can tick an item without loading every connector.
 */

/**
 * Check a checklist item the way the drawer does — same three effects, so an
 * item the system checks is indistinguishable from one a manager clicked:
 * mark it done, enqueue its automation bundle (dedupe_key makes a second check
 * a no-op), and move the card forward. Never backwards: a rep already past the
 * target status keeps the status they have.
 *
 * Mirrors app/api/reps/[id]/checklist/[itemId]/route.ts. That route runs as the
 * signed-in manager and this runs as the system, which is the whole reason the
 * logic is here twice rather than shared — the route's auth, RLS client and
 * activity actor have no meaning in the worker.
 */
export async function completeChecklistItem(
  repId: number,
  templateKey: string,
): Promise<{ alreadyDone: boolean; enqueued: number; movedTo: string | null }> {
  const { data: item, error } = await db()
    .schema(ONBOARDING)
    .from("checklist_items")
    .select("id, label, automation_key, status")
    .eq("rep_id", repId)
    .eq("template_key", templateKey)
    .maybeSingle();
  if (error) throw new Error(`checklist_items: ${error.message}`);
  if (!item) throw new Error(`rep ${repId} has no "${templateKey}" checklist item`);
  if (item.status === "done") return { alreadyDone: true, enqueued: 0, movedTo: null };

  const { error: uErr } = await db()
    .schema(ONBOARDING)
    .from("checklist_items")
    .update({ status: "done", completed_by: null, completed_at: new Date().toISOString() })
    .eq("id", item.id);
  if (uErr) throw new Error(`checklist update: ${uErr.message}`);

  let enqueued = 0;
  let movedTo: string | null = null;
  if (item.automation_key) {
    const rows = outboxRowsFor(item.automation_key as string, repId);
    if (rows.length) {
      const { error: oErr } = await db()
        .schema(ONBOARDING)
        .from("outbox")
        .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (oErr) throw new Error(`outbox: ${oErr.message}`);
      enqueued = rows.length;
    }
    const target = STATUS_ON_COMPLETE[item.automation_key as string];
    if (target) movedTo = await advanceStatus(repId, target);
  }
  return { alreadyDone: false, enqueued, movedTo };
}

/**
 * Move a rep to `target` only if that is further along than where they are.
 * Returns the new status, or null when the rep was already at or past it — a
 * late signal can never drag an `active` rep back to an earlier column.
 */
export async function advanceStatus(repId: number, target: string): Promise<string | null> {
  const { data: rep } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .select("status")
    .eq("id", repId)
    .maybeSingle();
  const from = REP_STATUSES.indexOf((rep?.status ?? "invited") as RepStatus);
  if (REP_STATUSES.indexOf(target as RepStatus) <= from) return null;
  const { error } = await db().schema(ONBOARDING).from("reps").update({ status: target }).eq("id", repId);
  if (error) throw new Error(`advanceStatus: ${error.message}`);
  return target;
}
