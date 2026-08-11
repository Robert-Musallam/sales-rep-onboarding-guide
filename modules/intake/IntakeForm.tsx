"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { repsApi } from "@/modules/reps/api-client";
import type { Territory } from "@/modules/reps/types";

/**
 * Manager kick-off form — the native replacement for the first Jotform.
 * Submitting creates the rep + checklist and queues the invite SMS (with the
 * pre-filled rep-info Jotform link) for the worker.
 */
export function IntakeForm({ territories, managers }: { territories: Territory[]; managers: string[] }) {
  const router = useRouter();
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    personal_email: "",
    territory_id: "",
    manager_name: "",
    expected_start: "",
    how_heard: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { id } = await repsApi.create({ ...f, territory_id: Number(f.territory_id) });
      router.push(`/reps?open=${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create rep");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-navy mb-1">New Sales Rep</h1>
      <p className="text-[13px] text-muted mb-5">
        Kicks off onboarding: creates the rep, builds their checklist, and queues the welcome text
        with their info form link.
      </p>

      <form onSubmit={submit} className="card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required>
            <input className="input w-full" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} required />
          </Field>
          <Field label="Last name" required>
            <input className="input w-full" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} required />
          </Field>
          <Field label="Cell phone" required>
            <input
              className="input w-full"
              type="tel"
              placeholder="(702) 555-0123"
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              required
            />
          </Field>
          <Field label="Personal email" required>
            <input className="input w-full" type="email" value={f.personal_email} onChange={(e) => set("personal_email", e.target.value)} required />
          </Field>
          <Field label="Territory" required>
            <select className="select w-full" value={f.territory_id} onChange={(e) => set("territory_id", e.target.value)} required>
              <option value="">Select…</option>
              {territories.filter((t) => t.active).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hiring manager" required>
            <select className="select w-full" value={f.manager_name} onChange={(e) => set("manager_name", e.target.value)} required>
              <option value="">Select…</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected start" required>
            <input
              className="input w-full"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={f.expected_start}
              onChange={(e) => set("expected_start", e.target.value)}
              required
            />
          </Field>
          <Field label="How did they hear about us?">
            <input className="input w-full" value={f.how_heard} onChange={(e) => set("how_heard", e.target.value)} />
          </Field>
        </div>

        {err && (
          <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>
        )}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Start onboarding"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-muted mb-1">
        {label}
        {required && <span className="text-red"> *</span>}
      </label>
      {children}
    </div>
  );
}
