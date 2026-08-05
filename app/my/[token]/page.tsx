import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/os/supabase/admin";
import { ONBOARDING_SCHEMA, TRAINING_SCHEMA } from "@/lib/os/schemas";
import { RepHub } from "./RepHub";

export const dynamic = "force-dynamic";

/**
 * Rep-facing onboarding hub — token-authenticated (no login). The token is the
 * whole credential, so reads happen server-side with the admin client and only
 * this rep's slice of data is passed to the page.
 */
export default async function RepHubPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: link } = await admin
    .schema(ONBOARDING_SCHEMA)
    .from("rep_links")
    .select("rep_id")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (!link) notFound();

  const [{ data: rep }, { data: items }] = await Promise.all([
    admin
      .schema(ONBOARDING_SCHEMA)
      .from("reps")
      .select("id, first_name, last_name, status, training_passed_at, territory:territories(name)")
      .eq("id", link.rep_id)
      .maybeSingle(),
    admin
      .schema(ONBOARDING_SCHEMA)
      .from("checklist_items")
      .select("label, status, sort_order")
      .eq("rep_id", link.rep_id)
      .order("sort_order"),
  ]);
  if (!rep) notFound();

  const t = admin.schema(TRAINING_SCHEMA);
  const { data: courses } = await t
    .from("courses")
    .select("id, title, description, sort_order, lessons(id, title, content_md, video_url, sort_order, active)")
    .eq("active", true)
    .order("sort_order");
  const { data: finalQuiz } = await t
    .from("quizzes")
    .select("id, title, pass_pct, questions(id, prompt, options, sort_order, active)")
    .eq("is_final", true)
    .eq("active", true)
    .maybeSingle();
  const { data: attempts } = finalQuiz
    ? await t
        .from("attempts")
        .select("score_pct, passed, created_at")
        .eq("rep_id", link.rep_id)
        .eq("quiz_id", finalQuiz.id)
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [] };

  // last_seen touch (best effort)
  await admin.schema(ONBOARDING_SCHEMA).from("rep_links").update({ last_seen: new Date().toISOString() }).eq("token", token);

  return (
    <RepHub
      token={token}
      rep={rep as never}
      checklist={(items ?? []) as never}
      courses={(courses ?? []) as never}
      finalQuiz={(finalQuiz ?? null) as never}
      attempts={(attempts ?? []) as never}
    />
  );
}
