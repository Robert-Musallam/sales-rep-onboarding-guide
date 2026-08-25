"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/os/supabase/client";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";

interface LinkRow {
  id: number;
  territory_id: number;
  token: string;
  active: boolean;
  uses: number;
  last_used_at: string | null;
  territory: { name: string } | null;
}

/**
 * The city intake links: one live URL per city, handed to the managers who file
 * new reps so they never need an account.
 *
 * The token is the credential, so this panel is the kill switch. Rotating
 * deactivates the old row and issues a new one — anyone still holding the old
 * URL is out immediately, and the reps it filed keep pointing at it.
 */
export function IntakeLinksPanel() {
  const supabase = createClient();
  const [rows, setRows] = useState<LinkRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const base = typeof window === "undefined" ? "" : window.location.origin;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .select("id, territory_id, token, active, uses, last_used_at, territory:territories(name)")
      .order("territory_id");
    if (error) setErr(error.message);
    else setRows((data ?? []) as unknown as LinkRow[]);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setActive(row: LinkRow, active: boolean) {
    setBusy(row.id);
    setErr(null);
    const { error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .update({ active })
      .eq("id", row.id);
    if (error) setErr(error.message);
    await load();
    setBusy(null);
  }

  /** Deactivate first: one live link per city is enforced by a partial index. */
  async function rotate(row: LinkRow) {
    setBusy(row.id);
    setErr(null);
    const { error: dErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .update({ active: false })
      .eq("id", row.id);
    if (dErr) {
      setErr(dErr.message);
      setBusy(null);
      return;
    }
    const { error } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("intake_links")
      .insert({ territory_id: row.territory_id, note: `Rotated ${new Date().toISOString().slice(0, 10)}` });
    if (error) setErr(error.message);
    await load();
    setBusy(null);
  }

  async function copy(row: LinkRow) {
    await navigator.clipboard.writeText(`${base}/intake/${row.token}`);
    setCopied(row.id);
    setTimeout(() => setCopied(null), 1500);
  }

  const live = rows.filter((r) => r.active);
  const retired = rows.filter((r) => !r.active);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        One link per city. Managers open it and file a new rep without logging in — the city is baked into the
        link and cannot be changed on the form. <strong className="text-navy">The link is the password</strong>:
        anyone holding it can file reps in that city, and every filing texts the phone number typed into the
        form. Rotate a link the moment it leaks or someone leaves.
      </p>

      {err && <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</div>}

      <div className="space-y-2">
        {live.map((row) => (
          <div key={row.id} className="card p-3 flex items-center gap-3 flex-wrap">
            <div className="font-semibold text-navy min-w-[110px]">{row.territory?.name ?? `#${row.territory_id}`}</div>
            <code className="text-[11px] text-muted flex-1 min-w-[220px] truncate">{`${base}/intake/${row.token}`}</code>
            <div className="text-[11px] text-muted whitespace-nowrap">
              {row.uses} rep{row.uses === 1 ? "" : "s"}
              {row.last_used_at ? ` · last ${row.last_used_at.slice(0, 10)}` : ""}
            </div>
            <button className="btn btn-sm" onClick={() => copy(row)}>
              {copied === row.id ? "Copied" : "Copy"}
            </button>
            <button className="btn btn-sm" disabled={busy === row.id} onClick={() => rotate(row)}>
              Rotate
            </button>
            <button className="btn btn-sm" disabled={busy === row.id} onClick={() => setActive(row, false)}>
              Disable
            </button>
          </div>
        ))}
        {!live.length && <div className="text-[13px] text-muted">No active links.</div>}
      </div>

      {retired.length > 0 && (
        <details>
          <summary className="text-[12px] font-semibold text-muted cursor-pointer">
            Retired links ({retired.length})
          </summary>
          <div className="space-y-2 mt-2">
            {retired.map((row) => (
              <div key={row.id} className="card p-3 flex items-center gap-3 flex-wrap opacity-70">
                <div className="font-semibold text-navy min-w-[110px]">
                  {row.territory?.name ?? `#${row.territory_id}`}
                </div>
                <code className="text-[11px] text-muted flex-1 min-w-[220px] truncate">…{row.token.slice(-8)}</code>
                <div className="text-[11px] text-muted">{row.uses} filed</div>
                <button className="btn btn-sm" disabled={busy === row.id} onClick={() => setActive(row, true)}>
                  Re-enable
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
