import { ENV } from "../env";
import { db } from "../db";

/**
 * Housecall Pro connector. Each RNB territory is its own HCP company. Key
 * resolution order:
 *   1. territories.hcp_api_key_env → named env var (explicit override)
 *   2. public.office_configs.hcp_api_key by location name — the keys the
 *      existing sales-reporting scenarios already use (live in this project)
 *   3. HCP_API_KEY env fallback
 *
 * Employee creation uses the public API (POST /employees). If the account's
 * plan doesn't expose that endpoint the call fails with a clear error and the
 * checklist item stays open for the manual/browser-agent path.
 */
export async function resolveHcpKey(opts: {
  apiKeyEnv?: string | null;
  territoryName?: string | null;
}): Promise<string> {
  if (opts.apiKeyEnv && process.env[opts.apiKeyEnv]) return process.env[opts.apiKeyEnv]!;
  if (opts.territoryName) {
    const { data } = await db()
      .from("office_configs")
      .select("hcp_api_key")
      .eq("location_name", opts.territoryName)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.hcp_api_key) return data.hcp_api_key as string;
  }
  if (ENV.hcpDefaultApiKey()) return ENV.hcpDefaultApiKey();
  throw new Error(
    `No HCP API key for territory "${opts.territoryName ?? "?"}" — expected office_configs row, ` +
      `${opts.apiKeyEnv ?? "HCP_API_KEY"} env var, or Settings > Territories override`,
  );
}

export async function createEmployee(opts: {
  apiKeyEnv?: string | null;
  territoryName?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  role?: string;
}): Promise<{ id?: string; raw: unknown }> {
  const key = await resolveHcpKey(opts);
  const res = await fetch(`${ENV.hcpBaseUrl()}/employees`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      first_name: opts.firstName,
      last_name: opts.lastName,
      email: opts.email,
      mobile_number: opts.phone ?? undefined,
      role: opts.role ?? "field tech",
    }),
  });
  if (!res.ok) {
    throw new Error(`hcp createEmployee: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: j.id, raw: j };
}

/** Cheap credential check used by scripts/verify_hcp.ts and the health panel. */
export async function listEmployees(opts: {
  apiKeyEnv?: string | null;
  territoryName?: string | null;
}): Promise<number> {
  const key = await resolveHcpKey(opts);
  const res = await fetch(`${ENV.hcpBaseUrl()}/employees?page_size=1`, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`hcp listEmployees: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { total_items?: number; employees?: unknown[] };
  return j.total_items ?? j.employees?.length ?? 0;
}
