import { NextResponse } from "next/server";
import { ActionError, requireUser } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";

export const dynamic = "force-dynamic";

/** POST /api/reps/[id]/link — get-or-create the rep's tokenized hub URL. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser();
    const { id } = await params;
    const repId = Number(id);

    const { data: existing } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("rep_links")
      .select("token")
      .eq("rep_id", repId)
      .eq("active", true)
      .maybeSingle();

    let token = existing?.token as string | undefined;
    if (!token) {
      const { data: created, error } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("rep_links")
        .insert({ rep_id: repId })
        .select("token")
        .single();
      if (error) throw new ActionError(error.message, 500);
      token = created.token as string;
    }

    const base = process.env.APP_BASE_URL ?? "";
    return NextResponse.json({ ok: true, url: `${base}/my/${token}` });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
