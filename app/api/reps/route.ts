import { NextResponse } from "next/server";
import { ActionError, requireUser, logEntityActivity } from "@/lib/os/entity";
import { SHARED_SCHEMA } from "@/lib/os/schemas";
import { parseIntake, createRepFromIntake } from "@/lib/onboarding/intake";

export const dynamic = "force-dynamic";

/**
 * POST /api/reps — the signed-in manager intake (replaces Jotform 261604930668664).
 * Creates the rep, instantiates the checklist from the template, and enqueues
 * the invite bundle (Jotform prefill + welcome SMS) for the worker.
 *
 * Shares its body with the login-free city links (see lib/onboarding/intake.ts
 * and /api/intake/[token]); the difference is the door, not what gets created.
 */
export async function POST(req: Request) {
  try {
    const { supabase, email, id: userId } = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    const fields = parseIntake(body);
    const repId = await createRepFromIntake(supabase, fields, { createdBy: userId });

    await logEntityActivity(supabase, SHARED_SCHEMA, "entity_activity", {
      entity_type: "rep",
      entity_id: String(repId),
      actor_id: userId,
      actor_type: "user",
      actor_label: email,
      action: "rep_created",
      summary: `Intake submitted for ${fields.first_name} ${fields.last_name}`,
    });

    return NextResponse.json({ ok: true, id: repId });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
