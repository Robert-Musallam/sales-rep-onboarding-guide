import { NextResponse } from "next/server";
import { ActionError, requireUser, logEntityActivity } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA, SHARED_SCHEMA } from "@/lib/os/schemas";
import { REP_STATUSES } from "@/modules/reps/types";

export const dynamic = "force-dynamic";

/** POST /api/reps/[id]/status — board drag / drawer status change. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, email, id: userId } = await requireUser();
    const { id } = await params;
    const { status } = (await req.json()) as { status?: string };
    if (!status || !REP_STATUSES.includes(status as (typeof REP_STATUSES)[number])) {
      throw new ActionError(`Invalid status: ${status}`);
    }

    const { error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("reps")
      .update({ status })
      .eq("id", Number(id));
    if (error) throw new ActionError(error.message, 500);

    await logEntityActivity(supabase, SHARED_SCHEMA, "entity_activity", {
      entity_type: "rep",
      entity_id: id,
      actor_id: userId,
      actor_type: "user",
      actor_label: email,
      action: "status_changed",
      summary: `Status → ${status}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
