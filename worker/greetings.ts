import { db, ONBOARDING, getSetting } from "./db";
import { gate } from "./env";
import { renderTemplate } from "./templates";
import * as graph from "./connectors/graph";
import { academy, academyConfigured, academyTenantId } from "./connectors/academy";

/**
 * Daily birthday and work-anniversary greetings in Teams (told 2026-10-27).
 *
 * Reads Academy's directory mirror (public.directory_people — the hourly copy of
 * the company directory workbook), picks the people whose birthday or start
 * date falls today, and posts one message per person per kind into the chat
 * the settings name, as Robert (delegated token, like every Teams send).
 *
 * Runs inside the worker's 60-second pass but acts once a day: after
 * `greetings_hour` local time in `greetings_timezone`, and only if
 * `greetings_last_run_on` is not today. A day the Mac mini spends switched off
 * is skipped, never posted late.
 *
 * Idempotent: a row in onboarding.directory_greetings is inserted BEFORE the
 * post (unique per person, kind and day); only the pass that inserted it posts.
 * A post that fails deletes its row so the next pass retries the same day.
 */
export type Person = {
  full_name: string;
  job_title: string | null;
  office: string | null;
  email: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  start_date: string | null;
  notes: string | null;
};
export type Greeting = { kind: "birthday" | "anniversary"; key: string; person: Person; years: number };

const DEFAULT_TITLES = ["Design Consultant", "Project Manager", "Owner", "Scheduling Coordinator"];

/** Local calendar date and hour in a time zone. */
export function localNow(tz: string, at = new Date()): { ymd: string; year: number; month: number; day: number; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day), hour = Number(parts.hour) % 24;
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, year, month, day, hour };
}

/** "Desing Consultant" and friends: compare titles loosely. */
function titleMatches(title: string | null, wanted: string[]): boolean {
  const t = (title ?? "").toLowerCase().replace(/desing/g, "design").replace(/\s+/g, " ").trim();
  return wanted.some((w) => t === w.toLowerCase());
}

/**
 * Pure: who gets what on `date` (YYYY-MM-DD). Exported so a dry run and a test
 * can ask about any date without touching Teams.
 */
export function greetingsFor(people: Person[], date: { year: number; month: number; day: number }, titles = DEFAULT_TITLES): Greeting[] {
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const seen = new Set<string>();
  const out: Greeting[] = [];
  for (const p of people) {
    const name = (p.full_name ?? "").trim();
    if (!name || /^direct line$/i.test(name)) continue;
    if (!titleMatches(p.job_title, titles)) continue;
    const key = (p.email ?? "").trim().toLowerCase() || `name:${name.toLowerCase()}`;
    // The workbook lists owners and managers under two offices: one greeting each.
    if (seen.has(key)) continue;
    seen.add(key);

    const bm = p.birthday_month, bd = p.birthday_day;
    const birthdayToday =
      bm === date.month && (bd === date.day || (bm === 2 && bd === 29 && date.day === 28 && !leap(date.year)));
    if (birthdayToday) out.push({ kind: "birthday", key, person: p, years: 0 });

    if (p.start_date && !/table backfill/i.test(p.notes ?? "")) {
      const [sy, sm, sd] = p.start_date.split("-").map(Number);
      const years = date.year - sy;
      const sameDay = sm === date.month && (sd === date.day || (sm === 2 && sd === 29 && date.day === 28 && !leap(date.year)));
      if (sameDay && years >= 1) out.push({ kind: "anniversary", key, person: p, years });
    }
  }
  return out;
}

export async function loadPeople(): Promise<Person[]> {
  const tenantId = await academyTenantId();
  const { data, error } = await academy()
    .from("directory_people")
    .select("full_name, job_title, office, email, birthday_month, birthday_day, start_date, notes")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("category", "employee");
  if (error) throw new Error(`academy directory_people: ${error.message}`);
  return (data ?? []) as Person[];
}

async function setSetting(key: string, value: unknown) {
  const stamp = new Date().toISOString();
  const { error } = await db().schema(ONBOARDING).from("app_settings").upsert({ key, value, updated_at: stamp }, { onConflict: "key" });
  if (error) throw new Error(`app_settings ${key}: ${error.message}`);
}

/** The daily pass. Returns a one-line receipt, or null when there was nothing to do yet. */
export async function sweepGreetings(): Promise<string | null> {
  if (!academyConfigured()) return null;
  if ((await getSetting<boolean>("greetings_enabled", true)) === false) return null;
  const tz = (await getSetting<string>("greetings_timezone")) ?? "America/Los_Angeles";
  const hour = Number((await getSetting("greetings_hour")) ?? 8);
  const now = localNow(tz);
  if (now.hour < hour) return null;
  if ((await getSetting<string>("greetings_last_run_on")) === now.ymd) return null;

  const chatId = ((await getSetting<string>("greetings_chat_id")) ?? "").trim();
  if (!chatId) throw new Error("greetings_chat_id is empty — set it in Settings");
  const titles = (await getSetting<string[]>("greetings_job_titles")) ?? DEFAULT_TITLES;

  const due = greetingsFor(await loadPeople(), now, titles);
  let sent = 0, skipped = 0;
  for (const g of due) {
    const verdict = gate("teams");
    if (!verdict.allowed) {
      console.log(`greetings: ${verdict.reason} — would post ${g.kind} for ${g.person.full_name}`);
      skipped++;
      continue;
    }
    // Claim the day for this person+kind; a second pass gets no row and posts nothing.
    const { data: claimed, error: cErr } = await db()
      .schema(ONBOARDING)
      .from("directory_greetings")
      .upsert({ person_key: g.key, kind: g.kind, greeted_on: now.ymd, chat_id: chatId }, { onConflict: "person_key,kind,greeted_on", ignoreDuplicates: true })
      .select("id");
    if (cErr) throw new Error(`directory_greetings: ${cErr.message}`);
    if (!claimed?.length) continue;
    try {
      const { body } = await renderTemplate(`teams.${g.kind}`, {
        first_name: g.person.full_name.split(" ")[0],
        full_name: g.person.full_name,
        office: g.person.office,
        job_title: g.person.job_title,
        years: String(g.years),
        years_label: g.years === 1 ? "year" : "years",
      });
      const { id: messageId } = await graph.sendChatMessage(chatId, body);
      await db()
        .schema(ONBOARDING)
        .from("directory_greetings")
        .update({ message_id: messageId, sent_at: new Date().toISOString() })
        .eq("id", claimed[0].id);
      sent++;
    } catch (e) {
      await db().schema(ONBOARDING).from("directory_greetings").delete().eq("id", claimed[0].id);
      throw e;
    }
  }
  await setSetting("greetings_last_run_on", now.ymd);
  const receipt = `greetings ${now.ymd}: ${due.length} due, ${sent} posted, ${skipped} gated`;
  console.log(receipt);
  return receipt;
}
