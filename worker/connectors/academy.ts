import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Academy's Supabase project (the training platform, a different project from
 * this app's own). The worker only writes one table there: the company
 * directory mirror, public.directory_people. Service role, like the worker's
 * own client — RLS on that table admits only admins, and the worker is not a
 * roster member.
 *
 * Both variables come from .env.local on the Mac mini; unset means "no mirror",
 * and the sync says so once per pass instead of failing.
 */
let _client: SupabaseClient | null = null;

export function academyConfigured(): boolean {
  return Boolean(process.env.ACADEMY_SUPABASE_URL && process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY);
}

export function academy(): SupabaseClient {
  if (!_client) {
    const url = process.env.ACADEMY_SUPABASE_URL;
    const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("ACADEMY_SUPABASE_URL / ACADEMY_SUPABASE_SERVICE_ROLE_KEY are not set");
    _client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return _client;
}

export interface DirectoryRow {
  category: "employee" | "subcontractor" | "vendor" | "installer";
  section: string;
  job_title: string | null;
  full_name: string;
  phone: string | null;
  office: string | null;
  email: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  start_date: string | null; // YYYY-MM-DD, from column G of the workbook
  notes?: string | null; // column H of the workbook (employees only)
  active: boolean;
  sort_order: number;
  source_key: string;
}

/** The rnb tenant's id in Academy. */
export async function academyTenantId(slug = "rnb"): Promise<string> {
  const { data, error } = await academy().from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`academy tenants: ${error.message}`);
  if (!data) throw new Error(`academy tenant "${slug}" not found`);
  return data.id as string;
}

/** Upsert the workbook's rows by (tenant, source_key). Returns how many were written. */
export async function upsertDirectory(tenantId: string, rows: DirectoryRow[], source: string): Promise<number> {
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, tenant_id: tenantId, source, updated_at: now }));
    const { error, data } = await academy()
      .from("directory_people")
      .upsert(chunk, { onConflict: "tenant_id,source_key" })
      .select("id");
    if (error) throw new Error(`academy directory upsert: ${error.message}`);
    written += data?.length ?? 0;
  }
  return written;
}

/**
 * Rows the workbook no longer has (any sheet): mark inactive and say why, keep
 * the row. A person deleted from the Excel by mistake is then one edit away
 * from coming back, and nothing that referenced the row breaks.
 */
export async function retireMissing(tenantId: string, keepKeys: string[], note: string): Promise<number> {
  const { data, error } = await academy()
    .from("directory_people")
    .select("id, source_key, active")
    .eq("tenant_id", tenantId)
    .like("source", "excel%");
  if (error) throw new Error(`academy directory read: ${error.message}`);
  const keep = new Set(keepKeys);
  const gone = (data ?? []).filter((r) => r.source_key && !keep.has(r.source_key as string) && r.active);
  if (!gone.length) return 0;
  const { error: uErr } = await academy()
    .from("directory_people")
    .update({ active: false, notes: note, updated_at: new Date().toISOString() })
    .in(
      "id",
      gone.map((r) => r.id as string),
    );
  if (uErr) throw new Error(`academy directory retire: ${uErr.message}`);
  return gone.length;
}
