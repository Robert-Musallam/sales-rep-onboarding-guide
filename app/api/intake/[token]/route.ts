import { NextResponse } from "next/server";
import { ActionError, logEntityActivity } from "@/lib/os/entity";
import { createAdminClient } from "@/lib/os/supabase/admin";
import { ONBOARDING_SCHEMA, SHARED_SCHEMA } from "@/lib/os/schemas";
import { parseIntake, createRepFromIntake } from "@/lib/onboarding/intake";

export const dynamic = "force-dynamic";

/**
 * POST /api/intake/[token] — login-free intake for the city links.
 *
 * The token is the whole credential, so it is resolved server-side with the
 * admin client and the territory comes from the link row, never from the
 * payload: a tampered body can misspell a name but cannot file a rep into
 * another city.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const admin = createAdminClient();

    const { data: link } = await admin
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .select("id, territory_id, active, uses, territory:territories(name)")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();
    if (!link) throw new ActionError("This intake link is no longer active", 404);

    const body = (await req.json()) as Record<string, unknown>;
    const fields = parseIntake(body, link.territory_id as number);
    const repId = await createRepFromIntake(admin, fields, { intakeLinkId: link.id as number });

    const city = (link.territory as unknown as { name: string } | null)?.name ?? `territory ${link.territory_id}`;
    await admin
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .update({ uses: ((link as unknown as { uses?: number }).uses ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", link.id);

    await logEntityActivity(admin, SHARED_SCHEMA, "entity_activity", {
      entity_type: "rep",
      entity_id: String(repId),
      actor_type: "system",
      actor_label: `intake link · ${city}`,
      action: "rep_created",
      summary: `Intake submitted for ${fields.first_name} ${fields.last_name} via the ${city} link (manager: ${fields.manager_name})`,
    });

    return NextResponse.json({ ok: true, id: repId, first_name: fields.first_name, last_name: fields.last_name });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
