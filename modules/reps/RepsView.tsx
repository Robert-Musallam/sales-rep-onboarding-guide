"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Board } from "@/components/os/Board";
import { Grid } from "@/components/os/Grid";
import { KpiCard, KpiHeader } from "@/components/os/Kpi";
import { createClient } from "@/lib/os/supabase/client";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { repsApi } from "./api-client";
import { repColumns } from "./columns";
import { RepDrawer } from "./RepDrawer";
import { RepStatusBadge, STATUS_LABEL } from "./badges";
import type { Rep, RepStatus } from "./types";

/** Board stages = the rep lifecycle minus inactive (inactive lives in the grid). */
const STAGES = (["invited", "info_submitted", "contract_sent", "contract_signed", "provisioning", "active"] as RepStatus[]).map(
  (s) => ({ key: s, label: STATUS_LABEL[s] }),
);

export function RepsView({
  initialReps,
  managers = [],
  restrictedTo = null,
}: {
  initialReps: Rep[];
  managers?: string[];
  /** Set for manager-role users: they only ever see their own reps. */
  restrictedTo?: string | null;
}) {
  const [reps, setReps] = useState<Rep[]>(initialReps);
  const [view, setView] = useState<"board" | "grid">("board");
  const [openId, setOpenId] = useState<number | null>(null);
  const [managerFilter, setManagerFilter] = useState("");
  const params = useSearchParams();

  const refresh = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .schema(ONBOARDING_SCHEMA)
      .from("reps")
      .select("*, territory:territories(id, name)")
      .order("created_at", { ascending: false });
    if (restrictedTo) query = query.ilike("manager_name", restrictedTo);
    const { data } = await query;
    if (data) setReps(data as unknown as Rep[]);
  }, [restrictedTo]);

  // Deep link: /reps?open=<id> (used by Teams notifications).
  useEffect(() => {
    const open = params.get("open");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setOpenId(Number(open));
  }, [params]);

  const openRep = useMemo(() => reps.find((r) => r.id === openId) ?? null, [reps, openId]);
  const visible = useMemo(
    () =>
      managerFilter
        ? reps.filter((r) => (r.manager_name ?? "").toLowerCase() === managerFilter.toLowerCase())
        : reps,
    [reps, managerFilter],
  );
  const active = visible.filter((r) => r.status !== "inactive");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-navy">Onboarding</h1>
        <div className="flex gap-2 items-center flex-wrap">
          {!restrictedTo && managers.length > 0 && (
            <select
              className="select !py-1.5"
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              title="Filter by hiring manager"
            >
              <option value="">All managers</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} onClick={() => setView("board")}>
            Board
          </button>
          <button className={`btn btn-sm ${view === "grid" ? "btn-primary" : ""}`} onClick={() => setView("grid")}>
            Grid
          </button>
        </div>
      </div>

      <KpiHeader className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="In pipeline" value={String(active.filter((r) => r.status !== "active").length)} tone="navy" />
        <KpiCard label="Awaiting info form" value={String(active.filter((r) => r.status === "invited").length)} tone="amber" />
        <KpiCard label="Provisioning" value={String(active.filter((r) => r.status === "provisioning").length)} tone="teal" />
        <KpiCard label="Active reps" value={String(visible.filter((r) => r.status === "active").length)} tone="green" />
      </KpiHeader>

      {view === "board" ? (
        <Board
          items={active}
          stages={STAGES}
          stageOf={(r) => r.status}
          onMove={async (id, stage) => {
            await repsApi.setStatus(id, stage);
            await refresh();
          }}
          onCardClick={(r) => setOpenId(r.id)}
          renderCard={(r) => (
            <div className="space-y-1">
              <div className="font-semibold text-[13px] text-ink">
                {r.first_name} {r.last_name}
                {r.is_test && <span className="text-amber text-[10px] ml-1">TEST</span>}
              </div>
              <div className="text-[11px] text-muted">{r.territory?.name ?? "No territory"}</div>
              <RepStatusBadge status={r.status} />
            </div>
          )}
        />
      ) : (
        <Grid data={visible} columns={repColumns} onRowClick={(r) => setOpenId(r.id)} emptyMessage="No reps yet — kick one off from New Rep." />
      )}

      {openRep && <RepDrawer rep={openRep} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}
