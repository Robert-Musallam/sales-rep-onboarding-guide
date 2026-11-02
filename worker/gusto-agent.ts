import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { db, ONBOARDING, getSetting, logActivity } from "./db";
import { gate } from "./env";
import { alert } from "./alert";

/**
 * Gusto onboarding agent — worker side (Phase 3). NOT wired until Robert approves:
 *   worker/index.ts  → call sweepGustoAgent() in pass()
 *   worker/actions.ts → register "gusto.add_contractor": gustoAddContractor
 *
 * Sweep (every 60 s pass, cheap when idle):
 *   - gusto_agent_enabled=false → nothing
 *   - reps in info_submitted with gusto_agent_status IS NULL:
 *       territory in gusto_agent_territories → claim (null→queued) + outbox row
 *       otherwise                            → 'manual' + alert (ops adds by hand)
 *     is_test reps only when their email is in gusto_agent_test_emails.
 *   - in_progress older than 45 min → needs_review + alert (never re-queued).
 *
 * Handler: starts gusto-agent/run.sh detached so the 60 s pass is never blocked;
 * run.sh records the result itself (gusto-agent/record-result.ts).
 */
const REPO = path.join(__dirname, "..");
const RUN_LOCK = path.join(REPO, "gusto-agent", ".run.lock");
const STALE_MIN = 45;

type PickRep = {
  id: number; first_name: string; last_name: string; personal_email: string | null;
  contractor_type: string | null; business_name: string | null; is_test: boolean;
  territory: { name: string } | null;
};

export async function sweepGustoAgent(): Promise<void> {
  if ((await getSetting<boolean>("gusto_agent_enabled", false)) !== true) return;
  await db().schema(ONBOARDING).from("app_settings")
    .upsert({ key: "gusto_agent_heartbeat", value: new Date().toISOString() });

  const allowed = new Set(((await getSetting<string[]>("gusto_agent_territories", [])) ?? []).map((t) => t.toLowerCase()));
  const testEmails = new Set(((await getSetting<string[]>("gusto_agent_test_emails", [])) ?? []).map((e) => e.toLowerCase()));

  const { data: reps, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, contractor_type, business_name, is_test, territory:territories(name)")
    .eq("status", "info_submitted").is("gusto_agent_status", null).limit(10);
  if (error) throw new Error(`gusto sweep: ${error.message}`);

  for (const r of (reps ?? []) as unknown as PickRep[]) {
    const email = (r.personal_email ?? "").toLowerCase();
    if (r.is_test && !testEmails.has(email)) continue;
    const territory = r.territory?.name ?? "";
    if (!allowed.has(territory.toLowerCase())) {
      const { data: m } = await db().schema(ONBOARDING).from("reps")
        .update({ gusto_agent_status: "manual", gusto_agent_note: `territory ${territory || "(none)"} not in gusto_agent_territories` })
        .eq("id", r.id).is("gusto_agent_status", null).select("id");
      if (m?.length) {
        await logActivity(r.id, "gusto_agent_manual", `Gusto agent: ${territory || "no territory"} is not auto-sent — add in Gusto by hand`);
        await alert("Gusto: add rep by hand", `${r.first_name} ${r.last_name} (${territory || "no territory"}) reached Info Submitted; this territory is not on the agent's list.`);
      }
      continue;
    }
    const { data: claimed } = await db().schema(ONBOARDING).from("reps")
      .update({ gusto_agent_status: "queued", gusto_agent_at: new Date().toISOString() })
      .eq("id", r.id).is("gusto_agent_status", null).select("id");
    if (!claimed?.length) continue;
    await db().schema(ONBOARDING).from("outbox").upsert(
      { action_type: "gusto.add_contractor", rep_id: r.id, payload: {}, dedupe_key: `gusto.add_contractor:${r.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    await logActivity(r.id, "gusto_agent_queued", "Gusto agent: queued");
  }

  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const { data: stale } = await db().schema(ONBOARDING).from("reps")
    .update({ gusto_agent_status: "needs_review", gusto_agent_note: `run did not finish within ${STALE_MIN} min — check Gusto before re-arming` })
    .eq("gusto_agent_status", "in_progress").lt("gusto_agent_at", cutoff).select("id, first_name, last_name");
  for (const s of stale ?? []) {
    await logActivity(s.id, "gusto_agent_needs_review", "Gusto agent: run did not finish — needs review");
    await alert("Gusto agent: needs review", `${s.first_name} ${s.last_name}: the run did not finish. Check Gusto before re-arming (a second run could double-invite).`);
  }
}

function lockBusy(): boolean {
  if (!existsSync(RUN_LOCK)) return false;
  return Date.now() - statSync(RUN_LOCK).mtimeMs < STALE_MIN * 60_000;
}

function q(v: string | null | undefined): string {
  return `"${String(v ?? "").replace(/["\\]/g, "")}"`;
}

/** Outbox handler for "gusto.add_contractor". */
export async function gustoAddContractor(repId: number): Promise<{ done: true; note?: string } | { skipped: true; note: string }> {
  if ((await getSetting<boolean>("gusto_agent_enabled", false)) !== true) {
    return { skipped: true, note: "gusto_agent_enabled=false" };
  }
  if (lockBusy()) throw new Error("WAIT: another Gusto agent run is in progress");

  const { data: rep, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, contractor_type, business_name, gusto_agent_status, territory:territories(name)")
    .eq("id", repId).maybeSingle();
  if (error || !rep) throw new Error(`gusto: rep ${repId} not found`);
  const r = rep as unknown as PickRep & { gusto_agent_status: string | null };
  if (r.gusto_agent_status !== "queued") return { skipped: true, note: `gusto_agent_status=${r.gusto_agent_status} (not queued)` };

  const wantSend = (await getSetting<string>("gusto_agent_mode", "dry_run")) === "send";
  const verdict = gate("email", r.personal_email ?? "");
  const send = wantSend && verdict.allowed;

  const args = [
    `rep_id=${r.id}`, `first_name=${q(r.first_name)}`, `last_name=${q(r.last_name)}`,
    `email=${q(r.personal_email)}`, `territory=${q(r.territory?.name)}`,
    `contractor_type=${r.contractor_type ?? "individual"}`,
    r.contractor_type === "business" ? `business_name=${q(r.business_name)}` : "",
  ].filter(Boolean).join(" ");

  await db().schema(ONBOARDING).from("reps")
    .update({ gusto_agent_status: "in_progress", gusto_agent_at: new Date().toISOString() }).eq("id", r.id);

  // Fast path (gusto-agent/fast-add.js) is used when app_settings.gusto_agent_fast = true.
  const fast = (await getSetting<boolean>("gusto_agent_fast", false)) === true;
  const repJson = JSON.stringify({
    rep_id: r.id, first_name: r.first_name, last_name: r.last_name, email: r.personal_email,
    territory: r.territory?.name ?? null, contractor_type: r.contractor_type ?? "individual",
    business_name: r.contractor_type === "business" ? r.business_name : null,
  });
  const child = spawn("/bin/bash", [path.join(REPO, "gusto-agent", "run.sh"), args, ...(send ? ["--send"] : [])], {
    cwd: REPO, detached: true, stdio: "ignore",
    env: { ...process.env, GUSTO_REP_ID: String(r.id), ...(fast ? { GUSTO_REP_JSON: repJson } : {}) },
  });
  child.unref();

  const mode = send ? "send" : `dry_run${wantSend && !verdict.allowed ? ` (send gated: ${verdict.reason})` : ""}`;
  await logActivity(r.id, "gusto_agent_started", `Gusto agent: run started (${mode})`);
  return { done: true, note: `run.sh started (${mode})` };
}
