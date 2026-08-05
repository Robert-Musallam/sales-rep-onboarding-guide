"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/os/supabase/client";
import { TRAINING_SCHEMA } from "@/lib/os/schemas";
import { Badge } from "@/components/os/Badge";
import { EmptyState } from "@/components/os/EmptyState";

/**
 * Training admin: courses → lessons + quiz (questions, pass %). Reps consume
 * this from their tokenized hub; passing the FINAL quiz auto-completes the
 * "Training curriculum passed" checklist item.
 */
interface Course { id: number; title: string; description: string | null; sort_order: number; active: boolean }
interface Lesson { id: number; course_id: number; title: string; content_md: string | null; video_url: string | null; sort_order: number; active: boolean }
interface Quiz { id: number; course_id: number | null; title: string; pass_pct: number; is_final: boolean; active: boolean }
interface Question { id: number; quiz_id: number; prompt: string; options: string[]; correct_index: number; sort_order: number; active: boolean }
interface Attempt { id: number; quiz_id: number; rep_id: number; score_pct: number; passed: boolean; created_at: string }

export function TrainingView() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().schema(TRAINING_SCHEMA).from("courses").select("*").order("sort_order");
    if (error) setErr(error.message);
    else setCourses((data ?? []) as Course[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function addCourse() {
    const title = prompt("Course title:");
    if (!title) return;
    const { error } = await createClient()
      .schema(TRAINING_SCHEMA)
      .from("courses")
      .insert({ title, sort_order: (courses.at(-1)?.sort_order ?? 0) + 10 });
    if (error) setErr(error.message);
    else await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy">Training</h1>
        <button className="btn btn-sm btn-primary" onClick={addCourse}>+ New course</button>
      </div>
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}
      {courses.length === 0 ? (
        <EmptyState
          icon="training"
          title="No courses yet"
          message="Create courses, add lessons (text + video links), then build the final quiz reps must pass before running leads."
        />
      ) : (
        courses.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-navy">{c.title}</span>
              {!c.active && <Badge tone="slate" label="inactive" />}
              <span className="text-[12px] text-muted flex-1 truncate">{c.description}</span>
              <button className="btn btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? "Close" : "Manage"}
              </button>
            </div>
            {open === c.id && <CourseEditor course={c} onChanged={load} />}
          </div>
        ))
      )}
    </div>
  );
}

function CourseEditor({ course, onChanged }: { course: Course; onChanged: () => void }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = createClient().schema(TRAINING_SCHEMA);
    const [l, q] = await Promise.all([
      s.from("lessons").select("*").eq("course_id", course.id).order("sort_order"),
      s.from("quizzes").select("*").eq("course_id", course.id).maybeSingle(),
    ]);
    setLessons((l.data ?? []) as Lesson[]);
    const qz = (q.data as Quiz | null) ?? null;
    setQuiz(qz);
    if (qz) {
      const [qq, at] = await Promise.all([
        s.from("questions").select("*").eq("quiz_id", qz.id).order("sort_order"),
        s.from("attempts").select("*").eq("quiz_id", qz.id).order("created_at", { ascending: false }).limit(10),
      ]);
      setQuestions((qq.data ?? []) as Question[]);
      setAttempts((at.data ?? []) as Attempt[]);
    }
  }, [course.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function op(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setErr(null);
    const { error } = await fn();
    if (error) setErr(error.message);
    else {
      await load();
      onChanged();
    }
  }

  const s = () => createClient().schema(TRAINING_SCHEMA);

  return (
    <div className="mt-4 space-y-4">
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}

      {/* Lessons */}
      <div>
        <div className="text-[12px] font-semibold text-muted uppercase mb-2">Lessons</div>
        <ul className="space-y-2">
          {lessons.map((l) => (
            <LessonRow key={l.id} lesson={l} onSave={(patch) => op(() => s().from("lessons").update(patch).eq("id", l.id))} onDelete={() => op(() => s().from("lessons").delete().eq("id", l.id))} />
          ))}
        </ul>
        <button
          className="btn btn-sm mt-2"
          onClick={() => {
            const title = prompt("Lesson title:");
            if (title) op(() => s().from("lessons").insert({ course_id: course.id, title, sort_order: (lessons.at(-1)?.sort_order ?? 0) + 10 }));
          }}
        >
          + Add lesson
        </button>
      </div>

      {/* Quiz */}
      <div>
        <div className="text-[12px] font-semibold text-muted uppercase mb-2">Quiz</div>
        {!quiz ? (
          <button
            className="btn btn-sm"
            onClick={() => op(() => s().from("quizzes").insert({ course_id: course.id, title: `${course.title} — Quiz`, pass_pct: 80 }))}
          >
            + Create quiz
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[13px] flex-wrap">
              <span className="font-semibold">{quiz.title}</span>
              <label className="flex items-center gap-1.5 text-muted">
                Pass %
                <input
                  className="input w-16 !py-1"
                  type="number"
                  defaultValue={quiz.pass_pct}
                  onBlur={(e) => op(() => s().from("quizzes").update({ pass_pct: Number(e.target.value) }).eq("id", quiz.id))}
                />
              </label>
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={quiz.is_final}
                  onChange={(e) => op(() => s().from("quizzes").update({ is_final: e.target.checked }).eq("id", quiz.id))}
                />
                Final exam (passing completes the checklist gate)
              </label>
            </div>
            <ul className="space-y-2">
              {questions.map((q, i) => (
                <QuestionRow key={q.id} q={q} index={i} onSave={(patch) => op(() => s().from("questions").update(patch).eq("id", q.id))} onDelete={() => op(() => s().from("questions").delete().eq("id", q.id))} />
              ))}
            </ul>
            <button
              className="btn btn-sm"
              onClick={() => {
                const promptText = prompt("Question:");
                if (promptText)
                  op(() =>
                    s().from("questions").insert({
                      quiz_id: quiz.id,
                      prompt: promptText,
                      options: ["Option A", "Option B", "Option C", "Option D"],
                      correct_index: 0,
                      sort_order: (questions.at(-1)?.sort_order ?? 0) + 10,
                    }),
                  );
              }}
            >
              + Add question
            </button>
            {attempts.length > 0 && (
              <div className="text-[12px] text-muted">
                Recent attempts:{" "}
                {attempts.map((a) => `${a.passed ? "✅" : "❌"} ${Number(a.score_pct).toFixed(0)}%`).join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LessonRow({ lesson, onSave, onDelete }: { lesson: Lesson; onSave: (p: Partial<Lesson>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(lesson);
  return (
    <li className="border border-line rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium flex-1">{lesson.title}</span>
        {lesson.video_url && <Badge tone="teal" label="video" />}
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</button>
        <button className="btn btn-sm" onClick={onDelete}>Del</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <input className="input w-full" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          <input className="input w-full" placeholder="Video URL (optional)" value={d.video_url ?? ""} onChange={(e) => setD({ ...d, video_url: e.target.value || null })} />
          <textarea className="input w-full min-h-[120px] text-[12.5px]" placeholder="Lesson content (plain text / markdown)" value={d.content_md ?? ""} onChange={(e) => setD({ ...d, content_md: e.target.value || null })} />
          <button className="btn btn-sm btn-primary" onClick={() => { onSave({ title: d.title, video_url: d.video_url, content_md: d.content_md }); setOpen(false); }}>Save</button>
        </div>
      )}
    </li>
  );
}

function QuestionRow({ q, index, onSave, onDelete }: { q: Question; index: number; onSave: (p: Partial<Question>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(q);
  return (
    <li className="border border-line rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] flex-1">
          <span className="text-muted">{index + 1}.</span> {q.prompt}
        </span>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</button>
        <button className="btn btn-sm" onClick={onDelete}>Del</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <input className="input w-full" value={d.prompt} onChange={(e) => setD({ ...d, prompt: e.target.value })} />
          {d.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${q.id}`} checked={d.correct_index === i} onChange={() => setD({ ...d, correct_index: i })} title="Correct answer" />
              <input
                className="input flex-1"
                value={opt}
                onChange={(e) => setD({ ...d, options: d.options.map((o, j) => (j === i ? e.target.value : o)) })}
              />
              <button className="btn btn-sm" onClick={() => setD({ ...d, options: d.options.filter((_, j) => j !== i), correct_index: Math.min(d.correct_index, d.options.length - 2) })}>–</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => setD({ ...d, options: [...d.options, ""] })}>+ Option</button>
            <button className="btn btn-sm btn-primary" onClick={() => { onSave({ prompt: d.prompt, options: d.options, correct_index: d.correct_index }); setOpen(false); }}>Save</button>
          </div>
        </div>
      )}
    </li>
  );
}
