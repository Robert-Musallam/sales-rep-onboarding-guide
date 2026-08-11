import { createClient } from "@/lib/os/supabase/server";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import type { Rep, Territory } from "./types";

/**
 * Server-only reads for the reps section. Degrade to empty on error (pattern
 * inherited from the gcv-renewals per-module data.ts files) — the page renders
 * an honest empty state instead of a 500.
 */
/**
 * Reps list. When `restrictToManager` is set (manager-role users), only reps
 * whose hiring manager matches — managers see exactly the reps they created.
 */
export async function fetchReps(restrictToManager?: string | null): Promise<Rep[]> {
  const supabase = await createClient();
  let query = supabase
    .schema(ONBOARDING_SCHEMA)
    .from("reps")
    .select("*, territory:territories(id, name)")
    .order("created_at", { ascending: false });
  if (restrictToManager) query = query.ilike("manager_name", restrictToManager);
  const { data, error } = await query;
  if (error) {
    console.error("fetchReps:", error.message);
    return [];
  }
  return (data ?? []) as unknown as Rep[];
}

/** Manager names for the intake dropdown (app_settings.managers, Settings-editable). */
export async function fetchManagers(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema(ONBOARDING_SCHEMA)
    .from("app_settings")
    .select("value")
    .eq("key", "managers")
    .maybeSingle();
  if (error || !Array.isArray(data?.value)) return [];
  return data.value as string[];
}

export async function fetchTerritories(): Promise<Territory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema(ONBOARDING_SCHEMA)
    .from("territories")
    .select("*")
    .order("name");
  if (error) {
    console.error("fetchTerritories:", error.message);
    return [];
  }
  return (data ?? []) as unknown as Territory[];
}
