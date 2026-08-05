"use client";

import { useState } from "react";

interface HubRep {
  id: number;
  first_name: string;
  last_name: string;
  status: string;
  training_passed_at: string | null;
  territory: { name: string } | null;
}
interface HubItem { label: string; status: string; sort_order: number }
interface HubLesson { id: number; title: string; content_md: string | null; video_url: string | null; sort_order: number; active: boolean }
interface HubCourse { id: number; title: string; description: string | null; sort_order: number; lessons: HubLesson[] }
interface HubQuestion { id: number; prompt: string; options: string[]; sort_order: number; active: boolean }
interface HubQuiz { id: number; title: string; pass_pct: number; questions: HubQuestion[] }
interface HubAttempt { score_pct: number; passed: boolean; created_at: string }

/** The rep's personal onboarding page: progress, curriculum, and the readiness test. */
export function RepHub({
  token,
  rep,
  checklist,
  courses,
  finalQuiz,
  attempts,
}: {
  token: string;
  rep: HubRep;
  checklist: HubItem[];
  courses: HubCourse[];
  finalQuiz: HubQuiz | null;
  attempts: HubAttempt[];
}) {
  const doneCount = checklist.filter((i) => i.status === "done").length;
  const passed = Boolean(rep.training_passed_at) || attempts.some((a) => a.passed);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-navy text-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white text-navy grid place-items-center font-extrabold text-sm">RNB</div>
          <div>
            <div className="font-bold leading-tight">Welcome, {rep.first_name}!</div>
            <div className="text-[12px] text-white/70">
              Rock N Block onboarding · {rep.territory?.name ?? ""}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* Progress */}
        <section className="card p-4">
          <h2 className="font-bold text-navy mb-2">Your onboarding progress</h2>
          <div className="h-2 rounded-full bg-line overflow-hidden mb-3">
            <div
              className="h-full bg-green transition-all"
              style={{ width: `${checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0}%` }}
            />
          </div>
          <ul className="grid sm:grid-cols-2 gap-1.5 text-[13px]">
            {checklist.map((i) => (
              <li key={i.label} className={i.status === "done" ? "text-muted line-through" : "text-ink"}>
                {i.status === "done" ? "✅" : "⬜️"} {i.label}
              </li>
            ))}
          </ul>
        </section>

        {/* Curriculum */}
        <section className="card p-4">
          <h2 className="font-bold text-navy mb-1">Training curriculum</h2>
          <p className="text-[13px] text-muted mb-3">
            Work through every lesson, then take the readiness test{finalQuiz ? ` (pass mark ${finalQuiz.pass_pct}%)` : ""}.
          </p>
          {courses.length === 0 && <p className="text-[13px] text-muted">Curriculum is being loaded — check back soon.</p>}
          <div className="space-y-3">
            {courses.map((c) => (
              <CourseBlock key={c.id} course={c} />
            ))}
          </div>
        </section>

        {/* Readiness test */}
        {finalQuiz && (
          <section className="card p-4">
            <h2 className="font-bold text-navy mb-1">{finalQuiz.title}</h2>
            {passed ? (
              <div className="text-[14px] text-green font-semibold">
                🎉 Passed — you&apos;re cleared to run leads!
              </div>
            ) : (
              <QuizForm token={token} quiz={finalQuiz} attempts={attempts} />
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function CourseBlock({ course }: { course: HubCourse }) {
  const [open, setOpen] = useState(false);
  const lessons = course.lessons.filter((l) => l.active).sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="border border-line rounded-xl p-3">
      <button className="w-full flex items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <div>
          <div className="font-semibold text-[14px] text-ink">{course.title}</div>
          {course.description && <div className="text-[12px] text-muted">{course.description}</div>}
        </div>
        <span className="text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {lessons.map((l) => (
            <div key={l.id} className="border-t border-line/60 pt-3">
              <div className="font-semibold text-[13px] mb-1">{l.title}</div>
              {l.video_url && (
                <a className="text-[13px] text-teal underline" href={l.video_url} target="_blank" rel="noreferrer">
                  ▶ Watch video
                </a>
              )}
              {l.content_md && (
                <div className="text-[13px] text-ink whitespace-pre-wrap leading-relaxed mt-1">{l.content_md}</div>
              )}
            </div>
          ))}
          {lessons.length === 0 && <div className="text-[12px] text-muted">No lessons yet.</div>}
        </div>
      )}
    </div>
  );
}

function QuizForm({ token, quiz, attempts }: { token: string; quiz: HubQuiz; attempts: HubAttempt[] }) {
  const questions = quiz.questions.filter((q) => q.active).sort((a, b) => a.sort_order - b.sort_order);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ score_pct: number; passed: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    if (Object.keys(answers).length < questions.length) {
      setErr("Please answer every question.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/my/${token}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiz_id: quiz.id, answers }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Submit failed");
      setResult(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className={`text-[14px] font-semibold ${result.passed ? "text-green" : "text-red"}`}>
        {result.passed
          ? `🎉 ${result.score_pct.toFixed(0)}% — you passed!`
          : `${result.score_pct.toFixed(0)}% — not quite (need ${quiz.pass_pct}%). Review the lessons and try again.`}
        {!result.passed && (
          <button className="btn btn-sm ml-3" onClick={() => { setResult(null); setAnswers({}); }}>
            Retake
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {attempts.length > 0 && (
        <div className="text-[12px] text-muted">
          Previous attempts: {attempts.map((a) => `${Number(a.score_pct).toFixed(0)}%`).join(", ")}
        </div>
      )}
      {questions.map((q, i) => (
        <div key={q.id}>
          <div className="text-[13.5px] font-semibold mb-1.5">
            {i + 1}. {q.prompt}
          </div>
          <div className="space-y-1">
            {q.options.map((opt, j) => (
              <label key={j} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  checked={answers[q.id] === j}
                  onChange={() => setAnswers({ ...answers, [q.id]: j })}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      ))}
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}
      <button className="btn btn-primary" disabled={busy || questions.length === 0} onClick={submit}>
        {busy ? "Scoring…" : "Submit answers"}
      </button>
    </div>
  );
}
