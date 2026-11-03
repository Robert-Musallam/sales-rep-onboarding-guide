import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { db, ONBOARDING, getSetting, logActivity } from "./db";
import { gate } from "./env";
import { alert } from "./alert";
import * as hcp from "./connectors/hcp";

/**
 * HCP user agent — worker side.
 *
 * Sweep (every 60 s pass; nothing unless hcp_agent_enabled=true):
 *   - reps with hcp_agent_status IS NULL whose checklist has Welcome message sent
 *     AND Team channels created done and Housecall Pro user created pending:
 *       territory in hcp_agent_territories → claim (null→queued) + outbox "hcp.create_user"
 *       otherwise                           → 'manual' + alert
 *     is_test reps only when their personal email is in gusto_agent_test_emails.
 *   - 'created' → 'checking' + outbox "hcp.check_user" (actions.ts ticks the item →
 *     hcp.verify_employee records the HCP id through the API)
 *   - in_progress older than 20 min → needs_review + alert.
 *
 * Handler "hcp.create_user": API duplicate check, API colors in use, then starts
 * gusto-agent/hcp-run.sh detached (records its own result via hcp-record.ts).
 * Shares the Gusto agent's run lock.
 */
const REPO = path.join(__dirname, "..");
const RUN_LOCK = path.join(REPO, "gusto-agent", ".run.lock");
const LOCK_STALE_MIN = 45;
const STALE_MIN = 20;

export async function sweepHcpAgent(): Promise<void> {
  if ((await getSetting<boolean>("hcp_agent_enabled", false)) !== true) return;
  await db().schema(ONBOARDING).from("app_settings")
    .upsert({ key: "hcp_agent_heartbeat", value: new Date().toISOString() });

  const allowed = new Set(((await getSetting<string[]>("hcp_agent_territories", [])) ?? []).map((t) => t.toLowerCase()));
  const testEmails = new Set(((await getSetting<string[]>("gusto_agent_test_emails", [])) ?? []).map((e) => e.toLowerCase()));

  const { data: reps, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, personal_email, is_test, territory:territories(name)")
    .is("hcp_agent_status", null).neq("status", "inactive").not("rnb_email", "is", null).limit(25);
  if (error) throw new Error(`hcp sweep: ${error.message}`);
  const ids = (reps ?? []).map((r) => r.id);
  if (ids.length) {
    const { data: items, error: iErr } = await db().schema(ONBOARDING).from("checklist_items")
      .select("rep_id, template_key, status").in("rep_id", ids).in("template_key", ["welcome_message", "team_channel", "hcp_user"]);
    if (iErr) throw new Error(`hcp sweep checklist: ${iErr.message}`);
    const st = (id: number, k: string) => (items ?? []).find((i) => i.rep_id === id && i.template_key === k)?.status;

    for (const r of (reps ?? []) as unknown as Array<{ id: number; first_name: string; last_name: string; personal_email: string | null; is_test: boolean; territory: { name: string } | null }>) {
      if (st(r.id, "welcome_message") !== "done" || st(r.id, "team_channel") !== "done" || st(r.id, "hcp_user") !== "pending") continue;
      if (r.is_test && !testEmails.has((r.personal_email ?? "").toLowerCase())) continue;
      const territory = r.territory?.name ?? "";
      if (!allowed.has(territory.toLowerCase())) {
        const { data: m } = await db().schema(ONBOARDING).from("reps")
          .update({ hcp_agent_status: "manual", hcp_agent_note: `territory ${territory || "(none)"} not in hcp_agent_territories` })
          .eq("id", r.id).is("hcp_agent_status", null).select("id");
        if (m?.length) {
          await logActivity(r.id, "hcp_agent_manual", `HCP agent: ${territory || "no territory"} is not automatic — add the HCP user by hand`);
          await alert("HCP: add user by hand", `${r.first_name} ${r.last_name} (${territory || "no territory"}) was welcomed; this territory is not on the HCP agent's list.`);
        }
        continue;
      }
      const { data: claimed } = await db().schema(ONBOARDING).from("reps")
        .update({ hcp_agent_status: "queued", hcp_agent_at: new Date().toISOString() })
        .eq("id", r.id).is("hcp_agent_status", null).select("id");
      if (!claimed?.length) continue;
      await db().schema(ONBOARDING).from("outbox").upsert(
        { action_type: "hcp.create_user", rep_id: r.id, payload: {}, dedupe_key: `hcp.create_user:${r.id}` },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
      await logActivity(r.id, "hcp_agent_queued", "HCP agent: add-team-member run queued");
    }
  }

  const { data: created } = await db().schema(ONBOARDING).from("reps")
    .update({ hcp_agent_status: "checking", hcp_agent_at: new Date().toISOString() })
    .eq("hcp_agent_status", "created").select("id");
  for (const c of created ?? []) {
    await db().schema(ONBOARDING).from("outbox").upsert(
      { action_type: "hcp.check_user", rep_id: c.id, payload: {}, dedupe_key: `hcp.check_user:${c.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  }

  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const { data: stale } = await db().schema(ONBOARDING).from("reps")
    .update({ hcp_agent_status: "needs_review", hcp_agent_note: `run did not finish within ${STALE_MIN} min — check HCP before re-arming (a second run could double-invite)` })
    .eq("hcp_agent_status", "in_progress").lt("hcp_agent_at", cutoff).select("id, first_name, last_name");
  for (const s of stale ?? []) {
    await logActivity(s.id, "hcp_agent_needs_review", "HCP agent: run did not finish — needs review");
    await alert("HCP agent: needs review", `${s.first_name} ${s.last_name}: the HCP run did not finish. Check HCP before re-arming.`);
  }
}

function lockBusy(): boolean {
  if (!existsSync(RUN_LOCK)) return false;
  return Date.now() - statSync(RUN_LOCK).mtimeMs < LOCK_STALE_MIN * 60_000;
}

/** Outbox handler for "hcp.create_user". */
export async function hcpCreateUser(repId: number): Promise<{ done: true; note?: string } | { skipped: true; note: string }> {
  if ((await getSetting<boolean>("hcp_agent_enabled", false)) !== true) return { skipped: true, note: "hcp_agent_enabled=false" };
  if (lockBusy()) throw new Error("WAIT: the Gusto agent's browser is in use by another run");

  const { data: rep, error } = await db().schema(ONBOARDING).from("reps")
    .select("id, first_name, last_name, rnb_email, phone_e164, hcp_agent_status, territory:territories(name, hcp_api_key_env)")
    .eq("id", repId).maybeSingle();
  if (error || !rep) throw new Error(`hcp: rep ${repId} not found`);
  const r = rep as unknown as { id: number; first_name: string; last_name: string; rnb_email: string | null; phone_e164: string | null; hcp_agent_status: string | null; territory: { name: string; hcp_api_key_env: string | null } | null };
  if (r.hcp_agent_status !== "queued") return { skipped: true, note: `hcp_agent_status=${r.hcp_agent_status} (not queued)` };

  // Duplicate check through the API (no browser needed).
  const existing = await hcp.findEmployee({
    apiKeyEnv: r.territory?.hcp_api_key_env, territoryName: r.territory?.name,
    email: r.rnb_email, firstName: r.first_name, lastName: r.last_name,
  });
  if (existing) {
    const note = `already in the ${r.territory?.name} HCP (employee ${existing.id}, matched by ${existing.matchedBy}) — no second user created; tick "Housecall Pro user created" to record it`;
    await db().schema(ONBOARDING).from("reps").update({ hcp_agent_status: "stopped", hcp_agent_note: note, hcp_agent_at: new Date().toISOString() }).eq("id", repId);
    await logActivity(repId, "hcp_agent_stopped", `HCP agent: ${note}`);
    await alert("HCP agent: user already exists", `${r.first_name} ${r.last_name}: ${note}`);
    return { done: true, note: "duplicate — stopped" };
  }
  const usedColors = await hcp.usedColors({ apiKeyEnv: r.territory?.hcp_api_key_env, territoryName: r.territory?.name }).catch(() => [] as string[]);

  const wantSend = (await getSetting<string>("hcp_agent_mode", "dry_run")) === "send";
  const v1 = gate("provision");
  const v2 = gate("email", r.rnb_email ?? "");
  const send = wantSend && v1.allowed && v2.allowed;

  await db().schema(ONBOARDING).from("reps")
    .update({ hcp_agent_status: "in_progress", hcp_agent_at: new Date().toISOString() }).eq("id", repId);

  const repJson = JSON.stringify({
    rep_id: r.id, first_name: r.first_name, last_name: r.last_name, email: r.rnb_email,
    phone: r.phone_e164, territory: r.territory?.name ?? null, used_colors: usedColors,
  });
  const child = spawn("/bin/bash", [path.join(REPO, "gusto-agent", "hcp-run.sh"), repJson, ...(send ? ["--send"] : [])], {
    cwd: REPO, detached: true, stdio: "ignore",
    env: { ...process.env, HCP_REP_ID: String(r.id) },
  });
  child.unref();

  const gated = !v1.allowed ? v1.reason : !v2.allowed ? v2.reason : "";
  const mode = send ? "send" : `dry_run${wantSend && gated ? ` (send gated: ${gated})` : ""}`;
  await logActivity(repId, "hcp_agent_started", `HCP agent: add-team-member run started (${mode})`);
  return { done: true, note: `hcp-run.sh started (${mode})` };
}
