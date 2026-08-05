import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

/** Service-role client — the worker bypasses RLS (it IS the system actor). */
let _db: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(ENV.supabaseUrl(), ENV.serviceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _db;
}

export const ONBOARDING = "onboarding";
export const TRAINING = "training";
export const SHARED = "shared";

export async function getSetting<T = string>(key: string, fallback: T | null = null): Promise<T | null> {
  const { data } = await db().schema(ONBOARDING).from("app_settings").select("value").eq("key", key).maybeSingle();
  return data ? (data.value as T) : fallback;
}

export async function getTemplate(key: string): Promise<{ subject: string | null; body: string } | null> {
  const { data } = await db()
    .schema(ONBOARDING)
    .from("message_templates")
    .select("subject, body")
    .eq("key", key)
    .maybeSingle();
  return (data as { subject: string | null; body: string } | null) ?? null;
}

/** System-actor activity log onto the rep's timeline. Non-fatal on failure. */
export async function logActivity(repId: number | string, action: string, summary: string, payload: Record<string, unknown> = {}) {
  const { error } = await db().schema(SHARED).from("entity_activity").insert({
    entity_type: "rep",
    entity_id: String(repId),
    actor_type: "system",
    actor_label: "onboarding-worker",
    action,
    summary,
    payload,
  });
  if (error) console.error("activity log failed:", error.message);
}
