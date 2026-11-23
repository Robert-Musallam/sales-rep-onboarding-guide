/**
 * Called by run.sh at the end of a worker-started run (GUSTO_REP_ID set).
 * Writes the outcome to onboarding.reps + onboarding.gusto_agent_runs, logs the
 * rep timeline, alerts on anything that is not a clean result, and re-queues
 * runs that only need to wait (AppFolio busy, low memory, SMS code pending).
 *
 *   npx tsx gusto-agent/record-result.ts <rep_id> <dry_run|send> <out.json>
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, ONBOARDING, logActivity } from "../worker/db";
import { alert } from "../worker/alert";
import { notifyRobert } from "../worker/notify";
import { completeChecklistItem } from "../worker/checklist";

// "Already there" stops that still mean the rep is in Gusto (invited or onboarded).
const IN_GUSTO_STOP = /^already_in_gusto:(Onboarding|Active)\b/i;

type SkillResult = {
  outcome?: string; stop_reason?: string | null; gusto_company?: string | null;
  invite_sent?: boolean; documents?: string[]; notes?: string;
};

// login.js / launcher codes that only mean "try again later"
const RETRY_LOGIN = new Set([10, 13, 14, 16]);
const RETRY_MIN = 15;

function lastJsonObject(text: string): SkillResult | null {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced : [text.slice(text.lastIndexOf("{"))];
  for (const c of candidates.reverse()) {
    try { return JSON.parse(c) as SkillResult; } catch { /* next */ }
  }
  return null;
}

async function requeue(repId: number, why: string, minutes = RETRY_MIN) {
  await db().schema(ONBOARDING).from("reps").update({ gusto_agent_status: "queued", gusto_agent_note: why }).eq("id", repId);
  await db().schema(ONBOARDING).from("outbox")
    .update({ state: "pending", run_after: new Date(Date.now() + minutes * 60_000).toISOString() })
    .eq("dedupe_key", `gusto.add_contractor:${repId}`);
  await logActivity(repId, "gusto_agent_waiting", `Gusto agent: ${why} — retry in ${minutes} min`);
}

async function main() {
  const [repIdS, mode, outPath] = process.argv.slice(2);
  const repId = Number(repIdS);
  if (!repId || !outPath) throw new Error("usage: record-result.ts <rep_id> <mode> <out.json>");
  const { data: rep } = await db().schema(ONBOARDING).from("reps")
    .select("first_name, last_name").eq("id", repId).maybeSingle();
  const who = rep ? `${rep.first_name} ${rep.last_name}` : `rep ${repId}`;

  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(readFileSync(outPath, "utf8")); } catch { /* empty / partial */ }

  // run.sh's own outcomes: launcher deferred or sign-in step
  if (raw.outcome === "deferred") return requeue(repId, `deferred (launcher exit ${raw.launcher_exit})`, 5);
  if (raw.outcome === "session") {
    const code = Number(raw.login_exit);
    if (code === 10) {
      // login.js marks .code-requested ("new" or "remind") when it texted a code / it is time
      // to remind; message Robert once per mark, then clear the mark.
      const mark = path.join(__dirname, ".code-requested");
      try {
        const age = Date.now() - statSync(mark).mtimeMs;
        const kind = readFileSync(mark, "utf8").trim();
        if (age < 10 * 60_000 && (kind === "new" || kind === "remind")) {
          const sent = await notifyRobert(
            kind === "new"
              ? `Gusto agent: Gusto just texted you a code. Enter it in the Gusto Chrome window on the Mac mini (tick "Remember this device"). ${who} is waiting to be added.`
              : `Gusto agent: still waiting for the Gusto code in the Gusto Chrome window on the Mac mini. ${who} is waiting to be added.`,
          );
          await logActivity(repId, "gusto_agent_notify", `Gusto agent: ${sent}`);
          writeFileSync(mark, "sent");
        }
      } catch { /* no mark */ }
    }
    if (RETRY_LOGIN.has(code)) return requeue(repId, `Gusto sign-in waiting (login exit ${code})`);
    await db().schema(ONBOARDING).from("reps").update({ gusto_agent_status: "stopped", gusto_agent_note: `sign-in failed (login exit ${code})` }).eq("id", repId);
    await db().schema(ONBOARDING).from("gusto_agent_runs").insert({ rep_id: repId, mode, outcome: "session", stop_reason: `login_exit_${code}`, result: raw });
    await alert("Gusto agent: sign-in failed", `${who}: sign-in step failed (exit ${code}). Check the Keychain item gusto-agent.`);
    return;
  }

  const result = lastJsonObject(String(raw.result ?? ""));
  const cost = typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : null;
  const duration = typeof raw.duration_ms === "number" ? raw.duration_ms : null;

  let status: string;
  let note: string;
  if (!result) {
    status = "needs_review"; note = `no parsable result (claude ${raw.subtype ?? "error"})`;
  } else if (result.invite_sent && result.outcome !== "added") {
    status = "needs_review"; note = `invite SENT but run ended '${result.outcome}' (${result.stop_reason ?? "no reason"}) — finish in Gusto`;
  } else if (result.outcome === "added" || result.outcome === "dry_run_ok") {
    status = result.outcome; note = `${result.gusto_company ?? ""}${result.documents?.length ? ` · docs: ${result.documents.join(", ")}` : ""}`;
  } else if (result.outcome === "stopped") {
    status = "stopped"; note = result.stop_reason ?? "stopped";
  } else {
    status = "needs_review"; note = `unexpected outcome '${result.outcome}'`;
  }

  await db().schema(ONBOARDING).from("reps").update({
    gusto_agent_status: status, gusto_agent_note: note.slice(0, 500),
    gusto_agent_company: result?.gusto_company ?? null, gusto_agent_at: new Date().toISOString(),
  }).eq("id", repId);
  await db().schema(ONBOARDING).from("gusto_agent_runs").insert({
    rep_id: repId, mode, outcome: result?.outcome ?? "needs_review", stop_reason: result?.stop_reason ?? null,
    gusto_company: result?.gusto_company ?? null, invite_sent: !!result?.invite_sent,
    documents: result?.documents ?? [], cost_usd: cost, duration_ms: duration, result: result ?? { raw_subtype: raw.subtype ?? null },
  });
  await logActivity(repId, `gusto_agent_${status}`, `Gusto agent (${mode}): ${status} — ${note}`.slice(0, 300));

  // The rep is in Gusto — added by this run, or already there from an earlier
  // invite. That is the fact "Gusto: rep added + contract sent" records, so tick
  // it the way the drawer does: it fires m365.create_user and moves the card to
  // contract_sent. The signature mail (watchers.ts) still owns contract_signed.
  // Rep 39 sat for two days because nothing ticked it after an already_in_gusto stop.
  const inGusto = status === "added" || (status === "stopped" && IN_GUSTO_STOP.test(note));
  if (mode === "send" && inGusto) {
    const r = await completeChecklistItem(repId, "gusto");
    await logActivity(repId, "gusto_item_checked",
      `Gusto agent: ticked "Gusto: rep added + contract sent"${r.alreadyDone ? " (was already done)" : ` — ${r.enqueued} action(s) queued`}`);
  }

  // Already ACTIVE in Gusto = onboarding finished, contract signed. The
  // "can now be paid" mail that normally carries that news was sent long ago
  // (or never reaches us), so nothing would move the card to contract_signed
  // and the M365 license agent would never pick the rep up (test rep 40,
  // 2026-11-23). Queue the same rep.gusto_signed action the mailbox watcher
  // uses: forward-only stage move + the usual ops text. "Onboarding" (invited,
  // not signed) still waits for the mail.
  if (mode === "send" && status === "stopped" && /^already_in_gusto:Active\b/i.test(note)) {
    const { error } = await db().schema(ONBOARDING).from("outbox").upsert(
      [{
        action_type: "rep.gusto_signed",
        rep_id: repId,
        payload: { source: "gusto_agent_already_active", gusto_company: result?.gusto_company ?? null },
        dedupe_key: `gusto_signed:agent_active:${repId}`,
      }],
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`outbox: ${error.message}`);
    await logActivity(repId, "gusto_already_active", "Gusto agent: rep is already Active in Gusto — treated as contract signed (rep.gusto_signed queued)");
  }

  if (status !== "added" && status !== "dry_run_ok") {
    await alert(`Gusto agent: ${status}`, `${who}: ${note}`);
  }
}

main().catch(async (e) => {
  console.error("record-result failed:", e?.message ?? e);
  await alert("Gusto agent: could not record result", String(e?.message ?? e)).catch(() => {});
  process.exit(1);
});
