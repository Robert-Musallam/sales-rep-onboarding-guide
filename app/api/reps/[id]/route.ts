import { NextResponse } from "next/server";
import { ActionError, requireUser } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";

export const dynamic = "force-dynamic";

/** Fields the drawer may edit directly. Provisioning results are worker-owned. */
const EDITABLE = new Set([
  "first_name",
  "last_name",
  "personal_email",
  "phone_e164",
  "phone_os",
  "home_address",
  "zip_code",
  "dob",
  "manager_name",
  "territory_id",
  "expected_start",
  "rnb_email",
  "hcp_username",
  "gusto_status",
  "greensky_status",
  "notes",
  "is_test",
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (EDITABLE.has(k)) patch[k] = v === "" ? null : v;
    }
    if (!Object.keys(patch).length) throw new ActionError("No editable fields in request");

    const { error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("reps")
      .update(patch)
      .eq("id", Number(id));
    if (error) throw new ActionError(error.message, 500);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
