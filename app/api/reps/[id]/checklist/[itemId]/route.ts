import { NextResponse } from "next/server";
import { ActionError, requireUser, logEntityActivity } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA, SHARED_SCHEMA } from "@/lib/os/schemas";
import { outboxRowsFor, STATUS_ON_COMPLETE } from "@/lib/onboarding/automations";
import { REP_STATUSES, type RepStatus } from "@/modules/reps/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/reps/[id]/checklist/[itemId] — the checklist engine.
 * `complete` marks the item done and, when it carries an automation_key,
 * enqueues that bundle's outbox actions (idempotent via dedupe_key — checking
 * twice never double-sends). `reopen` flips it back without un-sending anything.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { supabase, email, id: userId } = await requireUser();
    const { id, itemId } = await params;
    const repId = Number(id);
    const { action } = (await req.json()) as { action?: "complete" | "reopen" };
    if (action !== "complete" && action !== "reopen") throw new ActionError("action must be complete|reopen");

    const { data: item, error: iErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("checklist_items")
      .select("id, rep_id, template_key, label, automation_key, status")
      .eq("id", Number(itemId))
      .eq("rep_id", repId)
      .maybeSingle();
    if (iErr) throw new ActionError(iErr.message, 500);
    if (!item) throw new ActionError("Checklist item not found", 404);

    if (action === "complete" && item.status === "done") return NextResponse.json({ ok: true, enqueued: 0 });

    const { error: uErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("checklist_items")
      .update(
        action === "complete"
          ? { status: "done", completed_by: userId, completed_at: new Date().toISOString() }
          : { status: "pending", completed_by: null, completed_at: null },
      )
      .eq("id", item.id);
    if (uErr) throw new ActionError(uErr.message, 500);

    let enqueued = 0;
    let movedTo: string | null = null;
    if (action === "complete" && item.automation_key) {
      const rows = outboxRowsFor(item.automation_key, repId);
      if (rows.length) {
        const { error: oErr } = await supabase
          .schema(ONBOARDING_SCHEMA)
          .from("outbox")
          .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
        if (oErr) throw new ActionError(oErr.message, 500);
        enqueued = rows.length;
      }

      // The check itself moves the card. Forward-only, so re-checking an item
      // can never drag a rep back to an earlier column.
      const target = STATUS_ON_COMPLETE[item.automation_key];
      if (target) {
        const { data: rep, error: rErr } = await supabase
          .schema(ONBOARDING_SCHEMA)
          .from("reps")
          .select("status")
          .eq("id", repId)
          .maybeSingle();
        if (rErr) throw new ActionError(rErr.message, 500);
        const from = REP_STATUSES.indexOf((rep?.status ?? "invited") as RepStatus);
        if (REP_STATUSES.indexOf(target as RepStatus) > from) {
          const { error: sErr } = await supabase
            .schema(ONBOARDING_SCHEMA)
            .from("reps")
            .update({ status: target })
            .eq("id", repId);
          if (sErr) throw new ActionError(sErr.message, 500);
          movedTo = target;
        }
      }
    }

    await logEntityActivity(supabase, SHARED_SCHEMA, "entity_activity", {
      entity_type: "rep",
      entity_id: id,
      actor_id: userId,
      actor_type: "user",
      actor_label: email,
      action: action === "complete" ? "checklist_completed" : "checklist_reopened",
      summary:
        action === "complete"
          ? `Checked "${item.label}"${enqueued ? ` — queued ${enqueued} automation action(s)` : ""}${
              movedTo ? ` — moved to ${movedTo}` : ""
            }`
          : `Reopened "${item.label}"`,
    });

    return NextResponse.json({ ok: true, enqueued, movedTo });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
