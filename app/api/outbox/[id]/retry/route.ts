import { NextResponse } from "next/server";
import { ActionError, requireUser } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/outbox/[id]/retry — requeue a failed or gate-skipped action.
 * Used from the rep drawer (e.g. after flipping dry-run → send_enabled, or
 * after fixing a config error like an empty sender mailbox).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser();
    const { id } = await params;

    const { data, error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("outbox")
      .update({
        state: "pending",
        attempts: 0,
        last_error: null,
        run_after: new Date().toISOString(),
        executed_at: null,
      })
      .eq("id", Number(id))
      .in("state", ["failed", "skipped"])
      .select("id");
    if (error) throw new ActionError(error.message, 500);
    if (!data?.length) throw new ActionError("Action is not in a retriable state", 409);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
