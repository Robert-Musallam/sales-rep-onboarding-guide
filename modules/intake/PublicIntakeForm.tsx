"use client";

import { useState } from "react";

/**
 * The city intake form managers open from their link — no login, no account.
 *
 * The city is displayed, not chosen: it comes from the link and the server
 * takes it from there too, so the one field whose mistakes are expensive cannot
 * be got wrong. The manager only says who they are, and the dropdown leads with
 * the managers mapped to this city.
 */
export function PublicIntakeForm({
  token,
  city,
  cityManagers,
  otherManagers,
}: {
  token: string;
  city: string;
  cityManagers: string[];
  otherManagers: string[];
}) {
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    personal_email: "",
    manager_name: cityManagers.length === 1 ? cityManagers[0] : "",
    expected_start: "",
    how_heard: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const j = (await res.json()) as { error?: string; first_name?: string; last_name?: string };
      if (!res.ok) throw new Error(j.error ?? "Failed to submit");
      setDone(`${j.first_name} ${j.last_name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to submit");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-navy text-white px-4 py-4">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white text-navy grid place-items-center font-extrabold text-sm">RNB</div>
          <div>
            <div className="font-bold leading-tight">New Sales Rep</div>
            <div className="text-[12px] opacity-80">{city}</div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6">
        {done ? (
          <div className="card p-6 text-center space-y-3">
            <div className="text-3xl">✅</div>
            <h1 className="text-lg font-bold text-navy">{done} is on their way</h1>
            <p className="text-[13px] text-muted">
              Onboarding has started for {city}. They will get a welcome text with their info form in the next
              few minutes.
            </p>
            <button
              className="btn"
              onClick={() => {
                setDone(null);
                setBusy(false);
                setF({
                  first_name: "",
                  last_name: "",
                  phone: "",
                  personal_email: "",
                  manager_name: f.manager_name,
                  expected_start: "",
                  how_heard: "",
                });
              }}
            >
              Add another rep
            </button>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-muted mb-4">
              Starts onboarding for a new rep in <strong className="text-navy">{city}</strong>: builds their
              checklist and texts them their info form.
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
                <Field label="City">
                  <input className="input w-full bg-bg text-muted" value={city} readOnly tabIndex={-1} />
                </Field>
                <Field label="Hiring manager" required>
                  <select className="select w-full" value={f.manager_name} onChange={(e) => set("manager_name", e.target.value)} required>
                    <option value="">Select…</option>
                    {cityManagers.length > 0 && (
                      <optgroup label={`${city} managers`}>
                        {cityManagers.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherManagers.length > 0 && (
                      <optgroup label={cityManagers.length ? "Other managers" : "Managers"}>
                        {otherManagers.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    )}
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

              {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}

              <button className="btn btn-primary w-full" disabled={busy}>
                {busy ? "Starting…" : "Start onboarding"}
              </button>
            </form>
          </>
        )}
      </main>
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
