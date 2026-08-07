import { NextResponse } from "next/server";
import { ActionError, requireUser, logEntityActivity } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA, SHARED_SCHEMA } from "@/lib/os/schemas";
import { outboxRowsFor } from "@/lib/onboarding/automations";

export const dynamic = "force-dynamic";

/**
 * POST /api/reps — the native manager intake (replaces Jotform 261604930668664).
 * Creates the rep, instantiates the checklist from the template, and enqueues
 * the invite bundle (Jotform prefill + welcome SMS) for the worker.
 */
export async function POST(req: Request) {
  try {
    const { supabase, email, id: userId } = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;

    const firstName = String(body.first_name ?? "").trim();
    const lastName = String(body.last_name ?? "").trim();
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!firstName || !lastName) throw new ActionError("First and last name are required");
    if (phone.length !== 10 && phone.length !== 11) throw new ActionError("Phone must be 10 digits");
    const territoryId = Number(body.territory_id);
    if (!territoryId) throw new ActionError("Territory is required");
    const personalEmail = String(body.personal_email ?? "").trim();
    if (!personalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      throw new ActionError("A valid personal email is required");
    }
    const managerName = String(body.manager_name ?? "").trim();
    if (!managerName) throw new ActionError("Hiring manager is required");
    const expectedStart = String(body.expected_start ?? "").trim();
    if (!expectedStart) throw new ActionError("Expected start date is required");
    const today = new Date().toISOString().slice(0, 10);
    if (expectedStart < today) throw new ActionError("Expected start date cannot be in the past");

    const { data: rep, error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("reps")
      .insert({
        first_name: firstName,
        last_name: lastName,
        phone_e164: `+1${phone.slice(-10)}`,
        personal_email: personalEmail,
        manager_name: managerName,
        how_heard: (body.how_heard as string) || null,
        expected_start: expectedStart,
        territory_id: territoryId,
        is_test: Boolean(body.is_test),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new ActionError(error.message, 500);
    const repId = rep.id as number;

    // Instantiate the checklist from the active template.
    const { data: templates, error: tErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("checklist_templates")
      .select("key, label, sort_order, automation_key")
      .eq("active", true)
      .order("sort_order");
    if (tErr) throw new ActionError(tErr.message, 500);
    if (templates?.length) {
      const { error: iErr } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("checklist_items")
        .insert(
          templates.map((t) => ({
            rep_id: repId,
            template_key: t.key,
            label: t.label,
            sort_order: t.sort_order,
            automation_key: t.automation_key,
          })),
        );
      if (iErr) throw new ActionError(iErr.message, 500);
    }

    // Queue the invite (worker sends the Jotform-prefill SMS behind the gates).
    const rows = outboxRowsFor("intake_submitted", repId);
    if (rows.length) {
      const { error: oErr } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("outbox")
        .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (oErr) throw new ActionError(oErr.message, 500);
    }

    await logEntityActivity(supabase, SHARED_SCHEMA, "entity_activity", {
      entity_type: "rep",
      entity_id: String(repId),
      actor_id: userId,
      actor_type: "user",
      actor_label: email,
      action: "rep_created",
      summary: `Intake submitted for ${firstName} ${lastName}`,
    });

    return NextResponse.json({ ok: true, id: repId });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
