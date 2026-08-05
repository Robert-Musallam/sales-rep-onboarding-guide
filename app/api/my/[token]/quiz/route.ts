import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/os/supabase/admin";
import { ONBOARDING_SCHEMA, TRAINING_SCHEMA, SHARED_SCHEMA } from "@/lib/os/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/my/[token]/quiz — rep submits the readiness test.
 * Token IS the auth. Scores server-side (correct answers never reach the
 * browser), records the attempt, and on passing the FINAL quiz stamps
 * training_passed_at + completes the training checklist item.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const admin = createAdminClient();

    const { data: link } = await admin
      .schema(ONBOARDING_SCHEMA)
      .from("rep_links")
      .select("rep_id")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();
    if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const body = (await req.json()) as { quiz_id?: number; answers?: Record<string, number> };
    const quizId = Number(body.quiz_id);
    const answers = body.answers ?? {};
    if (!quizId) return NextResponse.json({ error: "quiz_id required" }, { status: 400 });

    const t = admin.schema(TRAINING_SCHEMA);
    const { data: quiz } = await t
      .from("quizzes")
      .select("id, pass_pct, is_final, active")
      .eq("id", quizId)
      .maybeSingle();
    if (!quiz?.active) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

    const { data: questions } = await t
      .from("questions")
      .select("id, correct_index")
      .eq("quiz_id", quizId)
      .eq("active", true);
    if (!questions?.length) return NextResponse.json({ error: "Quiz has no questions" }, { status: 400 });

    const correct = questions.filter((q) => answers[String(q.id)] === q.correct_index).length;
    const scorePct = (correct / questions.length) * 100;
    const passed = scorePct >= quiz.pass_pct;

    await t.from("attempts").insert({
      quiz_id: quizId,
      rep_id: link.rep_id,
      answers,
      score_pct: scorePct.toFixed(2),
      passed,
    });

    if (passed && quiz.is_final) {
      await admin
        .schema(ONBOARDING_SCHEMA)
        .from("reps")
        .update({ training_passed_at: new Date().toISOString() })
        .eq("id", link.rep_id)
        .is("training_passed_at", null);
      await admin
        .schema(ONBOARDING_SCHEMA)
        .from("checklist_items")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("rep_id", link.rep_id)
        .eq("template_key", "training")
        .eq("status", "pending");
      await admin.schema(SHARED_SCHEMA).from("entity_activity").insert({
        entity_type: "rep",
        entity_id: String(link.rep_id),
        actor_type: "system",
        actor_label: "training",
        action: "training_passed",
        summary: `Passed the readiness test (${scorePct.toFixed(0)}%)`,
      });
    }

    return NextResponse.json({ ok: true, score_pct: scorePct, passed });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
