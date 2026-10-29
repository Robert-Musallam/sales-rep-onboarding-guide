import { db, ONBOARDING } from "./db";
import type { DirectoryRow } from "./connectors/academy";

/**
 * Settings → People (onboarding.people) is a roles table — who sits on a Phone
 * Room, who is a city's manager — kept by hand. Its contact columns went stale
 * (told 2026-10-29: 13 rows without an email, none with a phone), so every
 * hourly directory pass now fills them from the workbook rows it just mirrored.
 *
 * Only email (when empty), phone (when the workbook has a number) and the link
 * itself are written. Roles, territories, the Azure id, active and the name are
 * operational and stay exactly as ops set them.
 *
 * Matching: by the stored directory_source_key, else by email, else by
 * normalised full name. A row that matches nothing is left alone and told so
 * once in its notes — fix it by adding the person to the workbook.
 */
export interface PeopleSyncResult {
  linked: number;
  updated: number;
  unmatched: string[];
}

interface PersonRow {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  directory_source_key: string | null;
}

const UNMATCHED_NOTE = "Not in the Company Directory; add them to the workbook to link.";

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** A real number only — the workbook writes "Teams" for people without one. */
function phoneOf(p: string | null): string | null {
  const digits = (p ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? (p as string).trim() : null;
}

export async function syncPeopleFromDirectory(rows: DirectoryRow[]): Promise<PeopleSyncResult> {
  const dir = rows.filter((r) => r.category === "employee" && r.active);
  const byKey = new Map(dir.map((r) => [r.source_key, r] as const));
  const byEmail = new Map<string, DirectoryRow>();
  const byName = new Map<string, DirectoryRow>();
  for (const r of dir) {
    const e = (r.email ?? "").toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, r);
    const n = norm(r.full_name);
    if (n && !byName.has(n)) byName.set(n, r);
  }

  const { data, error } = await db()
    .schema(ONBOARDING)
    .from("people")
    .select("id, full_name, email, phone, notes, directory_source_key");
  if (error) throw new Error(`people read: ${error.message}`);

  const result: PeopleSyncResult = { linked: 0, updated: 0, unmatched: [] };
  for (const p of (data ?? []) as PersonRow[]) {
    const match =
      (p.directory_source_key ? byKey.get(p.directory_source_key) : undefined) ??
      (p.email ? byEmail.get(p.email.toLowerCase()) : undefined) ??
      byName.get(norm(p.full_name)) ??
      null;
    const patch: Record<string, unknown> = {};
    if (!match) {
      result.unmatched.push(p.full_name);
      if (!p.directory_source_key && !(p.notes ?? "").includes(UNMATCHED_NOTE)) {
        patch.notes = [p.notes, UNMATCHED_NOTE].filter(Boolean).join(" ");
      }
    } else {
      if (p.directory_source_key !== match.source_key) {
        patch.directory_source_key = match.source_key;
        result.linked += 1;
      }
      if (!p.email && match.email) patch.email = match.email;
      const phone = phoneOf(match.phone);
      if (phone && phone !== p.phone) patch.phone = phone;
    }
    if (!Object.keys(patch).length) continue;
    const { error: uErr } = await db().schema(ONBOARDING).from("people").update(patch).eq("id", p.id);
    if (uErr) throw new Error(`people update ${p.id}: ${uErr.message}`);
    result.updated += 1;
  }
  return result;
}
