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
  // office_configs stores the keys as "Token <key>" (the header value the sales-
  // reporting scenarios paste in); every call here adds "Token " itself, so a
  // stored prefix made the header "Token Token …" → 401 on every territory
  // (2026-08 → 2026-11-03). Strip any stored scheme before returning.
  const bare = (k: string) => k.trim().replace(/^(token|bearer)\s+/i, "").trim();
  if (opts.apiKeyEnv && process.env[opts.apiKeyEnv]) return bare(process.env[opts.apiKeyEnv]!);
  if (opts.territoryName) {
    const { data } = await db()
      .from("office_configs")
      .select("hcp_api_key")
      .eq("location_name", opts.territoryName)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.hcp_api_key) return bare(data.hcp_api_key as string);
  }
  if (ENV.hcpDefaultApiKey()) return bare(ENV.hcpDefaultApiKey());
  throw new Error(
    `No HCP API key for territory "${opts.territoryName ?? "?"}" — expected office_configs row, ` +
      `${opts.apiKeyEnv ?? "HCP_API_KEY"} env var, or Settings > Territories override`,
  );
}

/**
 * The public HCP API cannot CREATE employees (POST /employees does not exist —
 * confirmed 404 on 2026-08-07). Creation stays manual in the HCP UI (browser
 * agent later); this looks the employee up by email/name so checking the box
 * VERIFIES the account exists and records its id.
 */
export async function findEmployee(opts: {
  apiKeyEnv?: string | null;
  territoryName?: string | null;
  email?: string | null;
  firstName: string;
  lastName: string;
}): Promise<{ id: string; email: string | null; matchedBy: "email" | "name" } | null> {
  const key = await resolveHcpKey(opts);
  const wantEmail = (opts.email ?? "").toLowerCase();
  const wantName = `${opts.firstName} ${opts.lastName}`.toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${ENV.hcpBaseUrl()}/employees?page=${page}&page_size=100`, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`hcp listEmployees: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as {
      employees?: Array<{ id: string; email?: string; first_name?: string; last_name?: string }>;
    };
    const list = j.employees ?? [];
    for (const e of list) {
      if (wantEmail && (e.email ?? "").toLowerCase() === wantEmail) {
        return { id: e.id, email: e.email ?? null, matchedBy: "email" };
      }
    }
    for (const e of list) {
      if (`${e.first_name ?? ""} ${e.last_name ?? ""}`.toLowerCase() === wantName) {
        return { id: e.id, email: e.email ?? null, matchedBy: "name" };
      }
    }
    if (list.length < 100) break;
  }
  return null;
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

/** Team-member colors already used in a territory account (color_hex, lowercase). */
export async function usedColors(opts: {
  apiKeyEnv?: string | null;
  territoryName?: string | null;
}): Promise<string[]> {
  const key = await resolveHcpKey(opts);
  const out = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${ENV.hcpBaseUrl()}/employees?page=${page}&page_size=100`, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`hcp usedColors: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { employees?: Array<{ color_hex?: string | null }> };
    const list = j.employees ?? [];
    for (const e of list) if (e.color_hex) out.add(e.color_hex.toLowerCase().replace(/^([^#])/, "#$1"));
    if (list.length < 100) break;
  }
  return [...out];
}
