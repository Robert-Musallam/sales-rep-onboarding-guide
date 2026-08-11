"use client";

import { useCallback, useEffect, useState } from "react";
import { DrawerShell } from "@/components/os/DrawerShell";
import { ActionBar } from "@/components/os/ActionBar";
import { ActivityFeed } from "@/components/os/ActivityFeed";
import { Badge } from "@/components/os/Badge";
import { createClient } from "@/lib/os/supabase/client";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { fmtDate } from "@/lib/utils";
import { repsApi } from "./api-client";
import { ItemStatusBadge, OutboxStateBadge, RepStatusBadge, STATUS_LABEL } from "./badges";
import type { ChecklistItem, OutboxRow, Rep, RepStatus, Territory } from "./types";
import { REP_STATUSES } from "./types";

const ACTIVITY_ICONS: Record<string, string> = {
  rep_created: "📝",
  status_changed: "🔀",
  checklist_completed: "✅",
  checklist_reopened: "↩️",
  checklist_autocompleted: "🤖",
  sms_sent: "💬",
  m365_user_created: "🪪",
  teams_dm_sent: "👋",
  phone_room_created: "📣",
  territory_chats_joined: "🌐",
  company_announcement: "🎉",
  welcome_email_sent: "✉️",
  hcp_user_created: "🛠️",
  business_cards_requested: "🪪",
  info_form_submitted: "📥",
};

export function RepDrawer({
  rep,
  onClose,
  onChanged,
}: {
  rep: Rep;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [hubUrl, setHubUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [ci, ob] = await Promise.all([
      supabase
        .schema(ONBOARDING_SCHEMA)
        .from("checklist_items")
        .select("*")
        .eq("rep_id", rep.id)
        .order("sort_order"),
      supabase
        .schema(ONBOARDING_SCHEMA)
        .from("outbox")
        .select("id, action_type, rep_id, state, attempts, last_error, run_after, created_at, executed_at, dry_run_log")
        .eq("rep_id", rep.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setItems((ci.data ?? []) as ChecklistItem[]);
    setOutbox((ob.data ?? []) as OutboxRow[]);
    const { data: terr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("territories")
      .select("*")
      .eq("active", true)
      .order("name");
    setTerritories((terr ?? []) as Territory[]);
  }, [rep.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, reload]);

  async function run(fn: () => Promise<unknown>, busyKey?: number) {
    setErr(null);
    if (busyKey !== undefined) setBusy(busyKey);
    try {
      await fn();
      setReload((k) => k + 1);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <DrawerShell
      title={`${rep.first_name} ${rep.last_name}${rep.is_test ? " (TEST)" : ""}`}
      subtitle={rep.territory?.name ?? "No territory"}
      meta={`Added ${fmtDate(rep.created_at)} · Manager: ${rep.manager_name ?? "—"}`}
      badges={
        <>
          <RepStatusBadge status={rep.status} />
          {rep.is_test && <Badge tone="amber" label="TEST REP" />}
          <select
            className="select ml-auto"
            value={rep.status}
            onChange={(e) => run(() => repsApi.setStatus(rep.id, e.target.value))}
          >
            {REP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s as RepStatus]}
              </option>
            ))}
          </select>
        </>
      }
      error={err}
      onClose={onClose}
    >
      {/* Contact + provisioning facts */}
      <ActionBar title="Profile">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] mb-2">
          <div className="text-muted">Location</div>
          <select
            className="select !py-1 !text-[13px]"
            value={rep.territory_id ?? ""}
            onChange={(e) => run(() => repsApi.update(rep.id, { territory_id: Number(e.target.value) }))}
          >
            <option value="" disabled>
              Select…
            </option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          <Fact label="Phone" value={rep.phone_e164} />
          <Fact label="Phone OS" value={rep.phone_os} />
          <Fact label="Personal email" value={rep.personal_email} />
          <Fact label="RNB email" value={rep.rnb_email} />
          <Fact label="Expected start" value={rep.expected_start ? fmtDate(rep.expected_start) : null} />
          <Fact label="How heard" value={rep.how_heard} />
          <Fact label="M365 temp password" value={rep.m365_temp_password} mono />
          <Fact label="HCP employee" value={rep.hcp_employee_id} />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() =>
              run(async () => {
                const { url } = await repsApi.repLink(rep.id);
                setHubUrl(url);
                await navigator.clipboard.writeText(url).catch(() => {});
              })
            }
          >
            {hubUrl ? "Hub link copied ✓" : "Copy onboarding hub link"}
          </button>
          {rep.jotform_info_submission_id && (
            <a
              className="btn btn-sm"
              href={`https://www.jotform.com/edit/${rep.jotform_info_submission_id}`}
              target="_blank"
              rel="noreferrer"
            >
              Info form ↗
            </a>
          )}
        </div>
        {hubUrl && <div className="mt-2 text-[11px] text-muted break-all">{hubUrl}</div>}
      </ActionBar>

      {/* Checklist — the heart of the drawer */}
      <ActionBar title={`Checklist (${doneCount}/${items.length})`}>
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={it.status === "done"}
                disabled={busy === it.id}
                onChange={(e) =>
                  run(
                    () => repsApi.completeItem(rep.id, it.id, e.target.checked ? "complete" : "reopen"),
                    it.id,
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] ${it.status === "done" ? "text-muted line-through" : "text-ink"}`}>
                  {it.label}
                </div>
                {it.automation_key && it.status !== "done" && (
                  <div className="text-[11px] text-teal">⚡ checking runs automations</div>
                )}
                {it.completed_at && (
                  <div className="text-[11px] text-muted">done {fmtDate(it.completed_at)}</div>
                )}
              </div>
              <ItemStatusBadge status={it.status} />
            </li>
          ))}
          {items.length === 0 && <li className="text-[13px] text-muted">No checklist yet.</li>}
        </ul>
      </ActionBar>

      {/* Automation queue — what the worker did / will do for this rep */}
      <ActionBar title="Automations">
        <ul className="space-y-2">
          {outbox.map((o) => (
            <li key={o.id} className="flex items-start gap-2.5 text-[12.5px]">
              <OutboxStateBadge state={o.state} />
              <div className="min-w-0 flex-1">
                <div className="text-ink font-medium">{o.action_type}</div>
                {o.dry_run_log?.note && <div className="text-[11px] text-amber">{o.dry_run_log.note}</div>}
                {o.last_error && <div className="text-[11px] text-red break-all">{o.last_error}</div>}
                <div className="text-[11px] text-muted">
                  {o.executed_at
                    ? new Date(o.executed_at).toLocaleString("en-US")
                    : `queued for ${new Date(o.run_after).toLocaleString("en-US")}`}
                  {o.attempts > 1 ? ` · ${o.attempts} attempts` : ""}
                </div>
              </div>
              {(o.state === "failed" || o.state === "skipped") && (
                <button className="btn btn-sm" onClick={() => run(() => repsApi.retryOutbox(o.id))}>
                  Retry
                </button>
              )}
            </li>
          ))}
          {outbox.length === 0 && <li className="text-[13px] text-muted">No automations queued yet.</li>}
        </ul>
      </ActionBar>

      <ActionBar title="Activity">
        <ActivityFeed entityType="rep" entityId={rep.id} icons={ACTIVITY_ICONS} reloadKey={reload} />
      </ActionBar>
    </DrawerShell>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <div className="text-muted">{label}</div>
      <div className={`text-ink truncate ${mono ? "font-mono text-[12px]" : ""}`} title={value ?? undefined}>
        {value || "—"}
      </div>
    </>
  );
}
