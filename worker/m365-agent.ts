import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { db, ONBOARDING, getSetting, logActivity } from "./db";
import { gate } from "./env";
import { alert } from "./alert";

/**
 * M365 license agent — worker side.
 *
 * Sweep (every 60 s pass, cheap when idle; does nothing unless m365_agent_enabled=true):
 *   - reps in contract_signed with m365_agent_status IS NULL and an M365 user (rnb_email):
 *       territory in m365_agent_territories → claim (null→queued) + outbox "m365.assign_license"
 *       otherwise                            → 'manual' + alert
 *     is_test reps only when their personal email is in gusto_agent_test_emails.
 *   - 'licensed' → 'checking' + outbox "m365.check_license" (actions.ts ticks the checklist item)
 *   - in_progress older than 20 min → needs_review + alert.
 *
 * Handler "m365.assign_license": starts gusto-agent/m365-run.sh detached; it records
 * its own result (gusto-agent/m365-record.ts). Shares the Gusto agent's run lock.
 */
const REPO = path.join(__dirname, "..");
const RUN_LOCK = path.join(REPO, "gusto-agent", ".run.lock");
const LOCK_STALE_MIN = 45;
const STALE_MIN = 20;

type PickRep = {
  id: number; first_name: string; last_name: string; personal_email: string | null;
  rnb_email: string | null; m365_user_id: string | null; is_test: boolean;
  m365_agent_status?: string | null; territory: { name: string } | null;
};

export async function sweepM365Agent(): Promise<void> {
  if ((await getSetting<boolean>("m365_agent_enabled", false)) !== true) return;
  await db().schema(ONBOARDING).from("app_settings")
    .upsert({ key: "m365_agent_heartbeat", value: new Date().toISOString() });

  const allowed = new Set(((await getSetting<string[]>("m365_agent_territories", [])) ?? []).map((t) => t.toLowerCase()));
  const testEmails = new Set(((await getSetting<string[]>("gusto_agent_test_emails", [])) ?? []).map((e) => e.toLowerCase()));

  const { data: reps, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, rnb_email, m365_user_id, is_test, territory:territories(name)")
    .eq("status", "contract_signed").is("m365_agent_status", null)
    .not("rnb_email", "is", null).not("m365_user_id", "is", null).limit(10);
  if (error) throw new Error(`m365 sweep: ${error.message}`);

  for (const r of (reps ?? []) as unknown as PickRep[]) {
    if (r.is_test && !testEmails.has((r.personal_email ?? "").toLowerCase())) continue;
    const territory = r.territory?.name ?? "";
    if (!allowed.has(territory.toLowerCase())) {
      const { data: m } = await db().schema(ONBOARDING).from("reps")
        .update({ m365_agent_status: "manual", m365_agent_note: `territory ${territory || "(none)"} not in m365_agent_territories` })
        .eq("id", r.id).is("m365_agent_status", null).select("id");
      if (m?.length) {
        await logActivity(r.id, "m365_agent_manual", `M365 agent: ${territory || "no territory"} is not automatic — assign the license by hand`);
        await alert("M365: assign license by hand", `${r.first_name} ${r.last_name} (${territory || "no territory"}) reached Contract Signed; this territory is not on the M365 agent's list.`);
      }
      continue;
    }
    const { data: claimed } = await db().schema(ONBOARDING).from("reps")
      .update({ m365_agent_status: "queued", m365_agent_at: new Date().toISOString() })
      .eq("id", r.id).is("m365_agent_status", null).select("id");
    if (!claimed?.length) continue;
    await db().schema(ONBOARDING).from("outbox").upsert(
      { action_type: "m365.assign_license", rep_id: r.id, payload: {}, dedupe_key: `m365.assign_license:${r.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    await logActivity(r.id, "m365_agent_queued", "M365 agent: license run queued");
  }

  // Licensed → tick "Microsoft license assigned" (handled in actions.ts so it fires the bundle).
  const { data: licensed } = await db().schema(ONBOARDING).from("reps")
    .update({ m365_agent_status: "checking", m365_agent_at: new Date().toISOString() })
    .eq("m365_agent_status", "licensed").select("id");
  for (const l of licensed ?? []) {
    await db().schema(ONBOARDING).from("outbox").upsert(
      { action_type: "m365.check_license", rep_id: l.id, payload: {}, dedupe_key: `m365.check_license:${l.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  }

  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const { data: stale } = await db().schema(ONBOARDING).from("reps")
    .update({ m365_agent_status: "needs_review", m365_agent_note: `run did not finish within ${STALE_MIN} min — check the license in M365 admin, then re-arm` })
    .eq("m365_agent_status", "in_progress").lt("m365_agent_at", cutoff).select("id, first_name, last_name");
  for (const s of stale ?? []) {
    await logActivity(s.id, "m365_agent_needs_review", "M365 agent: run did not finish — needs review");
    await alert("M365 agent: needs review", `${s.first_name} ${s.last_name}: the license run did not finish. Check M365 admin before re-arming.`);
  }
}

function lockBusy(): boolean {
  if (!existsSync(RUN_LOCK)) return false;
  return Date.now() - statSync(RUN_LOCK).mtimeMs < LOCK_STALE_MIN * 60_000;
}

/** Outbox handler for "m365.assign_license". */
export async function m365AssignLicense(repId: number): Promise<{ done: true; note?: string } | { skipped: true; note: string }> {
  if ((await getSetting<boolean>("m365_agent_enabled", false)) !== true) return { skipped: true, note: "m365_agent_enabled=false" };
  if (lockBusy()) throw new Error("WAIT: the Gusto agent's browser is in use by another run");

  const { data: rep, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, rnb_email, m365_agent_status").eq("id", repId).maybeSingle();
  if (error || !rep) throw new Error(`m365: rep ${repId} not found`);
  if (rep.m365_agent_status !== "queued") return { skipped: true, note: `m365_agent_status=${rep.m365_agent_status} (not queued)` };

  const wantSend = (await getSetting<string>("m365_agent_mode", "dry_run")) === "send";
  const verdict = gate("provision");
  const send = wantSend && verdict.allowed;

  await db().schema(ONBOARDING).from("reps")
    .update({ m365_agent_status: "in_progress", m365_agent_at: new Date().toISOString() }).eq("id", repId);

  const repJson = JSON.stringify({ rep_id: rep.id, upn: rep.rnb_email, name: `${rep.first_name} ${rep.last_name}` });
  const child = spawn("/bin/bash", [path.join(REPO, "gusto-agent", "m365-run.sh"), repJson, ...(send ? ["--send"] : [])], {
    cwd: REPO, detached: true, stdio: "ignore",
    env: { ...process.env, M365_REP_ID: String(rep.id) },
  });
  child.unref();

  const mode = send ? "send" : `dry_run${wantSend && !verdict.allowed ? ` (send gated: ${verdict.reason})` : ""}`;
  await logActivity(repId, "m365_agent_started", `M365 agent: license run started (${mode})`);
  return { done: true, note: `m365-run.sh started (${mode})` };
}
