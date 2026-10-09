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

/**
 * app_settings, read once per pass. The worker is one process per pass (launchd
 * every 60s), and a pass used to fetch its settings one key at a time: ~10
 * PostgREST requests a minute, ~14,000 a day, each one a metered Supabase log
 * entry, for values that only change when someone edits Settings (2026-10-09).
 * The first getSetting() now loads the whole table in one request and the rest
 * of the pass reads from memory. If that load fails, it falls back to the
 * per-key read, so a hiccup never changes what the worker does.
 */
let _settings: Map<string, unknown> | null = null;

async function loadSettings(): Promise<Map<string, unknown> | null> {
  if (_settings) return _settings;
  const { data, error } = await db().schema(ONBOARDING).from("app_settings").select("key, value");
  if (error || !data) return null;
  _settings = new Map((data as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  return _settings;
}

export async function getSetting<T = string>(key: string, fallback: T | null = null): Promise<T | null> {
  const all = await loadSettings();
  if (all) return all.has(key) ? (all.get(key) as T) : fallback;
  const { data } = await db().schema(ONBOARDING).from("app_settings").select("value").eq("key", key).maybeSingle();
  return data ? (data.value as T) : fallback;
}

/** Keeps this pass's copy in step after the worker itself writes a setting. */
export function rememberSetting(key: string, value: unknown): void {
  _settings?.set(key, value);
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
