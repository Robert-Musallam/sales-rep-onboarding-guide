import { createClient } from "@/lib/os/supabase/server";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import type { Rep, Territory } from "./types";

/**
 * Server-only reads for the reps section. Degrade to empty on error (pattern
 * inherited from the gcv-renewals per-module data.ts files) — the page renders
 * an honest empty state instead of a 500.
 */
export async function fetchReps(): Promise<Rep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema(ONBOARDING_SCHEMA)
    .from("reps")
    .select("*, territory:territories(id, name)")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchReps:", error.message);
    return [];
  }
  return (data ?? []) as unknown as Rep[];
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
