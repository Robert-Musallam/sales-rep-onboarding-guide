"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/os/supabase/client";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { Badge } from "@/components/os/Badge";

/**
 * Settings — the config surface for everything the automations read:
 * territories, people/rosters, message templates, app settings, checklist
 * template, and connection/queue health. Config CRUD writes go straight
 * through the RLS-scoped client (side effects only ever flow via the outbox).
 */
type Tab = "territories" | "people" | "templates" | "checklist" | "app" | "health";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "territories", label: "Territories" },
  { key: "people", label: "People" },
  { key: "templates", label: "Messages" },
  { key: "checklist", label: "Checklist" },
  { key: "app", label: "App Settings" },
  { key: "health", label: "Connections & Health" },
];

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("territories");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Settings</h1>
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? "btn-primary" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "territories" && <TableEditor
        table="territories"
        orderBy="name"
        columns={[
          { key: "name", label: "Name" },
          { key: "post_sales_chat_ids", label: "Post-sales chat IDs (JSON array)", json: true, wide: true },
          { key: "hcp_api_key_env", label: "HCP key env var" },
          { key: "gusto_note", label: "Gusto note" },
          { key: "active", label: "Active", bool: true },
        ]}
        newRow={{ name: "", post_sales_chat_ids: [], active: true }}
      />}
      {tab === "people" && <TableEditor
        table="people"
        orderBy="full_name"
        columns={[
          { key: "full_name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "azure_user_id", label: "Azure user ID", wide: true },
          { key: "roles", label: "Roles (JSON array)", json: true },
          { key: "territories", label: "Territories (JSON array — empty = all)", json: true },
          { key: "active", label: "Active", bool: true },
        ]}
        newRow={{ full_name: "", roles: [], territories: [], active: true }}
        help='Roles: "phone_room_roster", "welcome_email_bcc", "business_card_contact", "admin_notify"'
      />}
      {tab === "templates" && <TemplatesEditor />}
      {tab === "checklist" && <TableEditor
        table="checklist_templates"
        orderBy="sort_order"
        idKey="key"
        columns={[
          { key: "key", label: "Key", readonlyOnEdit: true },
          { key: "label", label: "Label", wide: true },
          { key: "sort_order", label: "Order", num: true },
          { key: "automation_key", label: "Automation" },
          { key: "auto", label: "Auto", bool: true },
          { key: "active", label: "Active", bool: true },
        ]}
        newRow={{ key: "", label: "", sort_order: 100, active: true, auto: false }}
        help="Automation keys are defined in code (lib/onboarding/automations.ts): gusto_done, license_done, hcp_done, cards_done."
      />}
      {tab === "app" && <AppSettingsEditor />}
      {tab === "health" && <HealthPanel />}
    </div>
  );
}

// ── Generic table editor ─────────────────────────────────────────────────────

interface Col {
  key: string;
  label: string;
  json?: boolean;
  bool?: boolean;
  num?: boolean;
  wide?: boolean;
  readonlyOnEdit?: boolean;
}

function TableEditor({
  table,
  columns,
  orderBy,
  newRow,
  idKey = "id",
  help,
}: {
  table: string;
  columns: Col[];
  orderBy: string;
  newRow: Record<string, unknown>;
  idKey?: string;
  help?: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().schema(ONBOARDING_SCHEMA).from(table).select("*").order(orderBy);
    if (error) setErr(error.message);
    else setRows(data ?? []);
  }, [table, orderBy]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(row: Record<string, unknown>, isNew: boolean) {
    setErr(null);
    const supabase = createClient().schema(ONBOARDING_SCHEMA).from(table);
    const { error } = isNew
      ? await supabase.insert(row)
      : await supabase.update(row).eq(idKey, row[idKey] as string | number);
    if (error) setErr(error.message);
    else {
      setDraft(null);
      await load();
    }
  }

  async function remove(row: Record<string, unknown>) {
    if (!confirm("Delete this row?")) return;
    const { error } = await createClient()
      .schema(ONBOARDING_SCHEMA)
      .from(table)
      .delete()
      .eq(idKey, row[idKey] as string | number);
    if (error) setErr(error.message);
    else await load();
  }

  return (
    <div className="space-y-3">
      {help && <p className="text-[12px] text-muted">{help}</p>}
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}
      <div className="card overflow-x-auto thin-scroll">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th key={c.key} className="text-left font-semibold text-muted px-2.5 py-2 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EditorRow key={String(row[idKey])} row={row} columns={columns} onSave={(r) => save(r, false)} onDelete={() => remove(row)} />
            ))}
          </tbody>
        </table>
      </div>
      {draft ? (
        <div className="card p-4 space-y-2">
          <div className="text-[12px] font-semibold text-muted uppercase">New row</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {columns.map((c) => (
              <FieldInput key={c.key} col={c} value={draft[c.key]} onChange={(v) => setDraft({ ...draft, [c.key]: v })} />
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={() => save(draft, true)}>Save</button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-sm" onClick={() => setDraft({ ...newRow })}>+ Add</button>
      )}
    </div>
  );
}

function EditorRow({
  row,
  columns,
  onSave,
  onDelete,
}: {
  row: Record<string, unknown>;
  columns: Col[];
  onSave: (r: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(row);
  if (!editing) {
    return (
      <tr className="border-b border-line/60 hover:bg-bg">
        {columns.map((c) => (
          <td key={c.key} className="px-2.5 py-2 max-w-[280px] truncate" title={fmt(row[c.key])}>
            {c.bool ? (row[c.key] ? "✓" : "—") : fmt(row[c.key])}
          </td>
        ))}
        <td className="px-2 py-1.5 whitespace-nowrap text-right">
          <button className="btn btn-sm" onClick={() => { setD(row); setEditing(true); }}>Edit</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-line/60 bg-bl/10">
      {columns.map((c) => (
        <td key={c.key} className="px-1.5 py-1.5">
          {c.readonlyOnEdit ? (
            <span className="px-1 text-muted">{fmt(row[c.key])}</span>
          ) : (
            <FieldInput col={c} value={d[c.key]} onChange={(v) => setD({ ...d, [c.key]: v })} bare />
          )}
        </td>
      ))}
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <button className="btn btn-sm btn-primary mr-1" onClick={() => { onSave(d); setEditing(false); }}>Save</button>
        <button className="btn btn-sm" onClick={onDelete}>Del</button>
      </td>
    </tr>
  );
}

function FieldInput({ col, value, onChange, bare }: { col: Col; value: unknown; onChange: (v: unknown) => void; bare?: boolean }) {
  const input = col.bool ? (
    <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  ) : (
    <input
      className={`input w-full ${col.wide ? "min-w-[220px]" : ""}`}
      value={col.json ? JSON.stringify(value ?? []) : String(value ?? "")}
      onChange={(e) => {
        if (col.json) {
          try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); }
        } else if (col.num) onChange(Number(e.target.value));
        else onChange(e.target.value || null);
      }}
    />
  );
  if (bare) return input;
  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted mb-0.5">{col.label}</label>
      {input}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── Message templates ────────────────────────────────────────────────────────

function TemplatesEditor() {
  const [rows, setRows] = useState<Array<{ key: string; channel: string; subject: string | null; body: string; description: string | null }>>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().schema(ONBOARDING_SCHEMA).from("message_templates").select("*").order("key");
    if (error) setErr(error.message);
    else setRows((data ?? []) as typeof rows);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(row: (typeof rows)[number]) {
    const { error } = await createClient()
      .schema(ONBOARDING_SCHEMA)
      .from("message_templates")
      .update({ subject: row.subject, body: row.body })
      .eq("key", row.key);
    if (error) setErr(error.message);
    else { setOpen(null); await load(); }
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">
        Vars use {"{{snake_case}}"} tokens: first_name, last_name, territory, manager_name, rnb_email, phone,
        info_form_link, rep_url. Bodies starting with @file: load from worker/templates/.
      </p>
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}
      {rows.map((r) => (
        <div key={r.key} className="card p-3">
          <div className="flex items-center gap-2">
            <Badge tone={r.channel === "sms" ? "teal" : r.channel === "email" ? "amber" : "navy"} label={r.channel} />
            <span className="font-semibold text-[13px]">{r.key}</span>
            <span className="text-[12px] text-muted truncate flex-1">{r.description}</span>
            <button className="btn btn-sm" onClick={() => setOpen(open === r.key ? null : r.key)}>
              {open === r.key ? "Close" : "Edit"}
            </button>
          </div>
          {open === r.key && (
            <div className="mt-3 space-y-2">
              {r.channel === "email" && (
                <input
                  className="input w-full"
                  placeholder="Subject"
                  value={r.subject ?? ""}
                  onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, subject: e.target.value } : x)))}
                />
              )}
              <textarea
                className="input w-full font-mono text-[12px] min-h-[160px]"
                value={r.body}
                onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, body: e.target.value } : x)))}
              />
              <button className="btn btn-sm btn-primary" onClick={() => save(r)}>Save</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── App settings ─────────────────────────────────────────────────────────────

function AppSettingsEditor() {
  const [rows, setRows] = useState<Array<{ key: string; value: unknown }>>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().schema(ONBOARDING_SCHEMA).from("app_settings").select("*").order("key");
    if (error) setErr(error.message);
    else setRows((data ?? []) as typeof rows);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(key: string, raw: string) {
    setErr(null);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw; // treat as plain string
    }
    const { error } = await createClient().schema(ONBOARDING_SCHEMA).from("app_settings").update({ value }).eq("key", key);
    if (error) setErr(error.message);
    else await load();
  }

  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-[12px] text-muted">
        Values are JSON — quote strings (&quot;robert@…&quot;), arrays as [&quot;a&quot;,&quot;b&quot;].
        welcome_email_sender and business_card_contact_email must be set before go-live.
      </p>
      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}
      {rows.map((r) => (
        <SettingRow key={r.key} k={r.key} initial={JSON.stringify(r.value)} onSave={save} />
      ))}
    </div>
  );
}

function SettingRow({ k, initial, onSave }: { k: string; initial: string; onSave: (k: string, v: string) => void }) {
  const [v, setV] = useState(initial);
  const dirty = v !== initial;
  return (
    <div className="card p-3 flex items-center gap-3">
      <div className="text-[12px] font-semibold w-56 shrink-0">{k}</div>
      <input className="input flex-1 font-mono text-[12px]" value={v} onChange={(e) => setV(e.target.value)} />
      <button className={`btn btn-sm ${dirty ? "btn-primary" : ""}`} disabled={!dirty} onClick={() => onSave(k, v)}>
        Save
      </button>
    </div>
  );
}

// ── Connections & health ─────────────────────────────────────────────────────

function HealthPanel() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Array<{ id: number; action_type: string; last_error: string | null; created_at: string }>>([]);
  const [msAccount, setMsAccount] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("outbox")
        .select("state")
        .gte("created_at", since);
      const c: Record<string, number> = {};
      for (const r of data ?? []) c[r.state] = (c[r.state] ?? 0) + 1;
      setCounts(c);
      const { data: f } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("outbox")
        .select("id, action_type, last_error, created_at")
        .eq("state", "failed")
        .order("created_at", { ascending: false })
        .limit(10);
      setFailed((f ?? []) as typeof failed);
      // oauth_tokens is service-role-only; presence is surfaced via app_settings copy? Show hint instead.
      const { data: s } = await supabase
        .schema(ONBOARDING_SCHEMA)
        .from("app_settings")
        .select("value")
        .eq("key", "admin_upn")
        .maybeSingle();
      setMsAccount(s ? String(s.value).replace(/"/g, "") : null);
    })();
  }, []);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-4 space-y-2">
        <div className="text-[12px] font-semibold text-muted uppercase">Microsoft delegated consent</div>
        <p className="text-[13px] text-muted">
          One-time: sign in as the account Teams messages should come from{msAccount ? ` (${msAccount})` : ""}.
          Required before any teams.* automation can send.
        </p>
        <a className="btn btn-sm btn-primary inline-flex" href="/api/oauth/microsoft/start">
          Connect Microsoft account
        </a>
      </div>

      <div className="card p-4">
        <div className="text-[12px] font-semibold text-muted uppercase mb-2">Outbox — last 7 days</div>
        <div className="flex gap-2 flex-wrap">
          {(["pending", "in_flight", "done", "skipped", "failed"] as const).map((s) => (
            <Badge
              key={s}
              tone={s === "done" ? "green" : s === "failed" ? "red" : s === "skipped" ? "amber" : "slate"}
              label={`${s}: ${counts[s] ?? 0}`}
            />
          ))}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="card p-4">
          <div className="text-[12px] font-semibold text-muted uppercase mb-2">Recent failures</div>
          <ul className="space-y-1.5 text-[12px]">
            {failed.map((f) => (
              <li key={f.id}>
                <span className="font-semibold">{f.action_type}</span>{" "}
                <span className="text-red break-all">{f.last_error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4 text-[13px] text-muted space-y-1">
        <div className="text-[12px] font-semibold text-muted uppercase">Send gates (worker env)</div>
        <p>Mode + kill switch live in the worker&apos;s environment, not here:</p>
        <p className="font-mono text-[12px]">RNB_AUTOMATION_MODE=dry_run|send_enabled · RNB_GLOBAL_KILL_SWITCH=1 · PILOT_SEND_ONLY=1</p>
        <p>Gate-skipped actions show in each rep&apos;s drawer with a preview and a Retry button.</p>
      </div>
    </div>
  );
}
