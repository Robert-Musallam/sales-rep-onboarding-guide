import { db, ONBOARDING } from "./db";
import type { DirectoryRow } from "./connectors/academy";

/**
 * Second copy of the company directory, in this app's own project
 * (onboarding.directory_people), written in the same hourly pass as Academy's
 * mirror (told 2026-10-29). Holding OS reaches only this project through its
 * proxy, so RNB → Settings → Company Directory reads from here. Same rows, same
 * keys, same retire rule: what the workbook no longer has turns inactive and
 * says why; nothing is deleted.
 */
export async function upsertRnbDirectory(rows: DirectoryRow[], source: string): Promise<number> {
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, source, updated_at: now }));
    const { data, error } = await db()
      .schema(ONBOARDING)
      .from("directory_people")
      .upsert(chunk, { onConflict: "source_key" })
      .select("id");
    if (error) throw new Error(`rnb directory upsert: ${error.message}`);
    written += data?.length ?? 0;
  }
  return written;
}

export async function retireRnbMissing(keepKeys: string[], note: string): Promise<number> {
  const { data, error } = await db()
    .schema(ONBOARDING)
    .from("directory_people")
    .select("id, source_key, active")
    .like("source", "excel%")
    .eq("active", true);
  if (error) throw new Error(`rnb directory read: ${error.message}`);
  const keep = new Set(keepKeys);
  const gone = (data ?? []).filter((r) => r.source_key && !keep.has(r.source_key as string));
  if (!gone.length) return 0;
  const { error: uErr } = await db()
    .schema(ONBOARDING)
    .from("directory_people")
    .update({ active: false, notes: note, updated_at: new Date().toISOString() })
    .in(
      "id",
      gone.map((r) => r.id as number),
    );
  if (uErr) throw new Error(`rnb directory retire: ${uErr.message}`);
  return gone.length;
}
