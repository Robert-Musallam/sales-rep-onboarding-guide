import { db, ONBOARDING, getSetting, logActivity } from "./db";

/**
 * Time-based sweeps. The outbox only executes rows someone else enqueued —
 * these fill the gap for "nothing happened, so do something": the trigger is
 * the passage of time, not a form submission or a checklist click.
 *
 * Each sweep runs at the top of every worker pass and enqueues outbox rows with
 * a dedupe_key, so the queue (not the sweep) owns delivery, retry and the send
 * gate. A sweep is therefore free to run every 60s: re-enqueuing is a no-op.
 */

const DEFAULTS = {
  afterHours: 24,
  maxAgeHours: 24 * 7,
  windowStart: 9,
  windowEnd: 19,
  timezone: "America/Los_Angeles",
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Milliseconds to add to a UTC instant to get tz wall-clock time. */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Push `due` forward to the next [startH, endH) local hour in tz, so a 24h
 * deadline that lands at 3am is delivered at 9am instead. Already inside the
 * window: unchanged.
 */
export function nextSendSlot(due: Date, tz: string, startH: number, endH: number): Date {
  if (!(startH >= 0 && endH <= 24 && startH < endH)) return due; // window misconfigured: send when due
  const off = tzOffsetMs(due, tz);
  const local = new Date(due.getTime() + off); // wall-clock, read via the UTC getters
  const hour = local.getUTCHours();
  if (hour >= startH && hour < endH) return due;

  const target = new Date(local);
  if (hour >= endH) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(startH, 0, 0, 0);
  // Wall-clock back to a real instant. Re-resolve the offset at the target so a
  // DST change between `due` and the send slot doesn't move the hour.
  let utc = new Date(target.getTime() - off);
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) utc = new Date(target.getTime() - off2);
  return utc;
}

/**
 * Rep was invited, never filled the info form: one nudge, 24h after the invite
 * SMS actually went out. Exactly one per rep, ever — the dedupe_key survives
 * even after the row is executed, so a rep who ignores the reminder is left to
 * their manager rather than texted again.
 *
 * Whether the rep has since submitted is NOT decided here: the row waits a day
 * before running, so `rep.info_form_reminder` re-checks status at send time.
 */
export async function sweepInfoFormReminders(): Promise<void> {
  if ((await getSetting<boolean>("info_reminder_enabled", true)) === false) return;
  const afterMs = num(await getSetting("info_reminder_after_hours"), DEFAULTS.afterHours) * 3600_000;
  const maxAgeMs = num(await getSetting("info_reminder_max_age_hours"), DEFAULTS.maxAgeHours) * 3600_000;
  const tz = (await getSetting<string>("info_reminder_timezone")) ?? DEFAULTS.timezone;
  const startH = num(await getSetting("info_reminder_window_start"), DEFAULTS.windowStart);
  const endH = num(await getSetting("info_reminder_window_end"), DEFAULTS.windowEnd);

  const { data: reps, error } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .select("id, first_name, last_name")
    .eq("status", "invited")
    .eq("is_test", false)
    .not("phone_e164", "is", null)
    .not("jotform_info_submission_id", "is", null);
  if (error) throw new Error(`reps: ${error.message}`);
  if (!reps?.length) return;

  // The invite SMS timestamp, not rep.created_at: an invite that was gated
  // (dry-run / pilot block) or still queued has no `done` row, and a rep who
  // never got the first text should not get a reminder about it.
  const { data: invites, error: e2 } = await db()
    .schema(ONBOARDING)
    .from("outbox")
    .select("rep_id, executed_at")
    .eq("action_type", "rep.invite")
    .eq("state", "done")
    .in(
      "rep_id",
      reps.map((r) => r.id),
    );
  if (e2) throw new Error(`invites: ${e2.message}`);

  const invitedAt = new Map<number, number>();
  for (const i of invites ?? []) {
    if (!i.executed_at) continue;
    const ts = Date.parse(i.executed_at as string);
    const prev = invitedAt.get(i.rep_id as number);
    if (prev === undefined || ts < prev) invitedAt.set(i.rep_id as number, ts);
  }

  const now = Date.now();
  const rows = [];
  for (const rep of reps) {
    const invited = invitedAt.get(rep.id);
    if (invited === undefined) continue;
    if (now - invited > maxAgeMs) continue; // long-abandoned rep: don't wake the dead
    rows.push({
      action_type: "rep.info_form_reminder",
      rep_id: rep.id,
      payload: {},
      dedupe_key: `info_reminder:rep.info_form_reminder:${rep.id}`,
      run_after: nextSendSlot(new Date(invited + afterMs), tz, startH, endH).toISOString(),
    });
  }
  if (!rows.length) return;

  // Which of these already exist. An upsert with ignoreDuplicates returns no
  // representation, so asking first is the only way to know what is genuinely
  // new — and only genuinely new reminders deserve a timeline entry.
  const { data: seen, error: e3 } = await db()
    .schema(ONBOARDING)
    .from("outbox")
    .select("dedupe_key")
    .in(
      "dedupe_key",
      rows.map((r) => r.dedupe_key),
    );
  if (e3) throw new Error(`dedupe lookup: ${e3.message}`);
  const known = new Set((seen ?? []).map((r) => r.dedupe_key as string));
  const fresh = rows.filter((r) => !known.has(r.dedupe_key));
  if (!fresh.length) return;

  // ignoreDuplicates still guards the (lock-file-improbable) concurrent pass.
  const { error: e4 } = await db()
    .schema(ONBOARDING)
    .from("outbox")
    .upsert(fresh, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (e4) throw new Error(`enqueue: ${e4.message}`);

  for (const row of fresh) {
    console.log(`[sweep] info-form reminder queued rep=${row.rep_id} for ${row.run_after}`);
    await logActivity(row.rep_id, "info_reminder_scheduled", `Info-form reminder scheduled for ${row.run_after}`, {
      run_after: row.run_after,
      dedupe_key: row.dedupe_key,
    });
  }
}
