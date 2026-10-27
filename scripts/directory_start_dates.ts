/**
 * One-time fill of the "Start Date" column (G) in the company directory
 * workbook, from public.employee_teams_chats.created_at (told 2026-10-27).
 *
 *   npx tsx scripts/directory_start_dates.ts --dry-run   # plan only, no writes
 *   npx tsx scripts/directory_start_dates.ts             # write
 *
 * Rules:
 *  - One person = one base email (the "+1", "+3" location variants collapse);
 *    several rows → the oldest created_at.
 *  - Only EMPTY G cells are filled; a date someone typed is never overwritten.
 *  - 2026-06-09 and 2026-06-23 are the days the table was back-filled from Make,
 *    not real start dates: those get written anyway, and column H gets the mark
 *    "start date approx. (table backfill)" appended after whatever note it had.
 *  - Main sheet gets the header "Start Date" in G6; the "No longer" sheet has no
 *    header row and gets dates only.
 *  - Dates are written as Excel serials with number format m/d/yyyy, so they are
 *    real dates like the Birthday column.
 *
 * Re-runnable: a second run finds every matched cell already filled and writes
 * nothing. Nothing is sent to anyone.
 */
import { db, getSetting } from "../worker/db";
import * as graph from "../worker/connectors/graph";

const DRY = process.argv.includes("--dry-run");
const SHEET_MAIN = "{00000000-0001-0000-0000-000000000000}";
const SHEET_FORMER = "{A925BD08-9C77-4D58-B4EC-CD9306C351C1}";
const BACKFILL_DAYS = new Set(["2026-06-09", "2026-06-23"]);
const MARK = "start date approx. (table backfill)";

const baseEmail = (e: string) => e.trim().toLowerCase().replace(/\+[^@]*@/, "@");
const serial = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
};

async function startDates(): Promise<Map<string, string>> {
  // Oldest created_at per person, as a calendar date (the table stores timestamptz).
  const { data, error } = await db()
    .from("employee_teams_chats")
    .select("assigned_employee_email, created_at")
    .not("assigned_employee_email", "is", null);
  if (error) throw new Error(`employee_teams_chats: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    const email = baseEmail(String(r.assigned_employee_email));
    const day = String(r.created_at).slice(0, 10);
    if (!email.includes("@") || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const prev = out.get(email);
    if (!prev || day < prev) out.set(email, day);
  }
  return out;
}

async function fillSheet(
  driveId: string,
  itemId: string,
  worksheetId: string,
  label: string,
  dates: Map<string, string>,
  writeHeader: boolean,
) {
  const range = await graph.excelUsedRange(driveId, itemId, worksheetId);
  const receipt = { filled: 0, kept: 0, unmatched: [] as string[], approx: 0 };
  console.log(`\n== ${label}: ${range.address} ==`);

  if (writeHeader) {
    const headerIdx = range.text.findIndex((row) => /^job title/i.test(String(row[0] ?? "")));
    if (headerIdx >= 0) {
      const rowNo = range.startRow + headerIdx;
      const current = String(range.text[headerIdx][6] ?? "").trim();
      if (!current) {
        console.log(`G${rowNo}: header "Start Date"`);
        if (!DRY) await graph.excelWriteRange(driveId, itemId, worksheetId, `G${rowNo}`, [["Start Date"]]);
      } else {
        console.log(`G${rowNo}: header already "${current}"`);
      }
    }
  }

  for (let i = 0; i < range.text.length; i++) {
    const row = range.text[i] ?? [];
    const email = String(row[4] ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    const rowNo = range.startRow + i;
    const name = String(row[1] ?? "").trim();
    if (String(row[6] ?? "").trim()) {
      receipt.kept++;
      continue;
    }
    const day = dates.get(baseEmail(email));
    if (!day) {
      receipt.unmatched.push(`${name} <${email}>`);
      continue;
    }
    const approx = BACKFILL_DAYS.has(day);
    const note = String(row[7] ?? "").trim();
    const newNote = approx && !note.includes(MARK) ? (note ? `${note}; ${MARK}` : MARK) : null;
    console.log(`G${rowNo}: ${name} → ${day}${approx ? " (approx)" : ""}${newNote ? ` · H: "${newNote}"` : ""}`);
    if (!DRY) {
      if (newNote) {
        await graph.excelWriteRange(driveId, itemId, worksheetId, `G${rowNo}:H${rowNo}`, [[serial(day), newNote]], [
          ["m/d/yyyy", "General"],
        ]);
      } else {
        await graph.excelWriteRange(driveId, itemId, worksheetId, `G${rowNo}`, [[serial(day)]], [["m/d/yyyy"]]);
      }
    }
    receipt.filled++;
    if (approx) receipt.approx++;
  }
  console.log(
    `${label}: ${receipt.filled} filled (${receipt.approx} approx), ${receipt.kept} already had a value, ${receipt.unmatched.length} without a date`,
  );
  for (const u of receipt.unmatched) console.log(`  no date: ${u}`);
  return receipt;
}

(async () => {
  const driveId = (await getSetting<string>("company_directory_drive_id")) ?? "";
  const itemId = (await getSetting<string>("company_directory_item_id")) ?? "";
  if (!driveId || !itemId) throw new Error("company_directory_drive_id / item_id are not set");
  const dates = await startDates();
  const approx = [...dates.values()].filter((d) => BACKFILL_DAYS.has(d)).length;
  console.log(`${DRY ? "DRY RUN — " : ""}${dates.size} people with a date in employee_teams_chats (${approx} on a back-fill day)`);
  const a = await fillSheet(driveId, itemId, SHEET_MAIN, "Rock N Block Company Directory", dates, true);
  const b = await fillSheet(driveId, itemId, SHEET_FORMER, "No longer", dates, false);
  console.log(`\nTOTAL: ${a.filled + b.filled} filled, ${a.approx + b.approx} marked approx, ${a.kept + b.kept} kept, ${a.unmatched.length + b.unmatched.length} without a date${DRY ? " (nothing written)" : ""}`);
})().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
