import { db, ONBOARDING, getSetting } from "./db";
import * as graph from "./connectors/graph";
import { academyConfigured, academyTenantId, retireMissing, upsertDirectory, type DirectoryRow } from "./connectors/academy";

/**
 * Company directory mirror (told 2026-10-26): the Excel workbook stays the
 * master, people keep editing it, and Academy's public.directory_people is a
 * read-only copy refreshed every hour. Each pass of the worker checks the
 * hour; the sync itself reads all five sheets of the workbook through Graph,
 * upserts one row per workbook line keyed by a stable source_key, and marks
 * anything the workbook no longer has as inactive.
 *
 * The workbook is hand-kept, so the parser follows how it is laid out, not a
 * schema: the main sheet has block headers in column A ("<City> - Sales &
 * Production", "General Management", …) and the four office lines above the
 * first block; the Sub Contractors sheet keeps name/phone/email in D/F/H, the
 * Vendors and Installers sheets in C/E/G; the "No longer" sheet is the main
 * layout with the office telling the block. Birthdays are month/day only.
 */
const EVERY_MIN = 60;
const SETTING = "company_directory_synced_at";

const SHEET = {
  main: "{00000000-0001-0000-0000-000000000000}",
  subs: "{03E47957-F502-44F1-8FCB-1DAACF4F18CD}",
  vendors: "{D4606F49-3637-4038-867A-BEF87520CC9F}",
  installers: "{B1878689-18B7-442A-881D-BDDCE2A90B32}",
  former: "{A925BD08-9C77-4D58-B4EC-CD9306C351C1}",
};

const SECTION_BY_OFFICE: Record<string, string> = {
  "OC/IE": "Orange County/Inland Empire",
  Denver: "Colorado",
  "CO Springs": "Colorado",
  Florida: "Tampa",
};
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s && !/^pending$/i.test(s) ? s : null);
const emailOf = (v: unknown) => {
  const s = text(v).toLowerCase();
  return s.includes("@") ? s : null;
};
/** "9-Nov" as text, or an Excel serial that the sheet formats d-mmm. */
function birthday(cellText: unknown, cellValue: unknown): [number | null, number | null] {
  const m = /^(\d{1,2})-([A-Za-z]{3})$/.exec(text(cellText));
  if (m && MONTHS[m[2].toLowerCase()]) return [MONTHS[m[2].toLowerCase()], Number(m[1])];
  if (typeof cellValue === "number" && cellValue > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + cellValue * 86_400_000);
    return [d.getUTCMonth() + 1, d.getUTCDate()];
  }
  return [null, null];
}

/** Column G "Start Date": "m/d/yyyy" text or an Excel serial → YYYY-MM-DD. */
function startDate(cellText: unknown, cellValue: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text(cellText));
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (typeof cellValue === "number" && cellValue > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + cellValue * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/** Same key the first import used: category:section:name, lower-case, dashed, numbered on repeats. */
function keyFor(seen: Map<string, number>, category: string, section: string, name: string): string {
  const base = `${category}:${section}:${name}`.toLowerCase().replace(/\s+/g, "-");
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

type Sheet = { text: string[][]; values: unknown[][] };

function parseMain(sheet: Sheet, active: boolean, order: { n: number }, seen: Map<string, number>): DirectoryRow[] {
  const rows: DirectoryRow[] = [];
  let section = active ? "Offices" : "";
  for (let i = 0; i < sheet.text.length; i++) {
    const t = sheet.text[i] ?? [];
    const a = text(t[0]);
    const name = text(t[1]);
    if (!a && !name) continue;
    const header = /^(.*?)\s+-\s+Sales & Production$/.exec(a);
    if (header && !name) {
      section = header[1] === "Orange County/Inland Empire" ? header[1] : header[1];
      continue;
    }
    if (/^(General Management|Phone Room|Maintenance Division)$/.test(a) && !name) {
      section = a;
      continue;
    }
    if (!name || /^name:$/i.test(name) || /^key:/i.test(a)) continue;
    if (!a && name) continue; // stray notes column text
    const office = orNull(text(t[3]));
    const block = active ? section : (office && SECTION_BY_OFFICE[office]) || office || "Former";
    const [bm, bd] = birthday(t[5], sheet.values[i]?.[5]);
    rows.push({
      category: "employee",
      section: block,
      job_title: orNull(a),
      full_name: name,
      phone: orNull(text(t[2])),
      office,
      email: emailOf(t[4]),
      birthday_month: bm,
      birthday_day: bd,
      start_date: startDate(t[6], sheet.values[i]?.[6]),
      active,
      sort_order: (order.n += 10),
      source_key: keyFor(seen, "employee", block, name),
    });
  }
  return rows;
}

function parseList(
  sheet: Sheet,
  category: DirectoryRow["category"],
  section: string,
  cols: { name: number; phone: number; email: number },
  order: { n: number },
  seen: Map<string, number>,
): DirectoryRow[] {
  const rows: DirectoryRow[] = [];
  for (const t of sheet.text) {
    const a = text(t[0]);
    const name = text(t[cols.name]);
    if (!a || !name || /^job title/i.test(a) || /directory:/i.test(text(t[6]) + text(t[7]))) continue;
    rows.push({
      category,
      section,
      job_title: orNull(a),
      full_name: name,
      phone: orNull(text(t[cols.phone])),
      office: null,
      email: emailOf(t[cols.email]),
      birthday_month: null,
      birthday_day: null,
      start_date: null,
      active: true,
      sort_order: (order.n += 10),
      source_key: keyFor(seen, category, section, name),
    });
  }
  return rows;
}

export async function readWorkbook(driveId: string, itemId: string): Promise<DirectoryRow[]> {
  const read = async (ws: string): Promise<Sheet> => {
    const r = await graph.excelUsedRange(driveId, itemId, ws);
    return { text: r.text, values: r.values };
  };
  const [main, subs, vendors, installers, former] = await Promise.all([
    read(SHEET.main), read(SHEET.subs), read(SHEET.vendors), read(SHEET.installers), read(SHEET.former),
  ]);
  const order = { n: 0 };
  const seen = new Map<string, number>();
  return [
    ...parseMain(main, true, order, seen),
    ...parseList(subs, "subcontractor", "Sub Contractors", { name: 3, phone: 5, email: 7 }, order, seen),
    ...parseList(vendors, "vendor", "Vendors", { name: 2, phone: 4, email: 6 }, order, seen),
    ...parseList(installers, "installer", "Installers", { name: 2, phone: 4, email: 6 }, order, seen),
    ...parseMain(former, false, order, seen),
  ];
}

/** Once an hour: workbook → Academy. Never throws past the caller's try/catch; logs a one-line receipt. */
export async function syncCompanyDirectory(opts: { force?: boolean } = {}): Promise<string | null> {
  if (!academyConfigured()) return null;
  const last = (await getSetting<string>(SETTING)) ?? "";
  if (!opts.force && last && Date.now() - Date.parse(last) < EVERY_MIN * 60_000) return null;

  const driveId = (await getSetting<string>("company_directory_drive_id")) ?? "";
  const itemId = (await getSetting<string>("company_directory_item_id")) ?? "";
  if (!driveId || !itemId) throw new Error("company_directory_drive_id / item_id are not set");

  const rows = await readWorkbook(driveId, itemId);
  if (rows.length < 50) throw new Error(`directory sync: only ${rows.length} rows parsed — refusing to retire the rest`);
  const tenantId = await academyTenantId();
  const stamp = new Date().toISOString();
  const written = await upsertDirectory(tenantId, rows, "excel_sync");
  const retired = await retireMissing(tenantId, rows.map((r) => r.source_key), `Not in the workbook as of ${stamp.slice(0, 10)}.`);

  await db()
    .schema(ONBOARDING)
    .from("app_settings")
    .upsert({ key: SETTING, value: stamp, updated_at: stamp }, { onConflict: "key" });
  const receipt = `directory sync: ${rows.length} workbook rows → ${written} upserted, ${retired} retired`;
  console.log(receipt);
  return receipt;
}
