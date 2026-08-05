import { createClient } from "@/lib/os/supabase/server";
import { SHARED_SCHEMA } from "@/lib/os/schemas";

export type ProfileRole = "admin" | "manager" | "staff";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
}

/** Returns the current user + profile, or null if unauthenticated. */
export async function getSessionUser(): Promise<{
  email: string;
  id: string;
  profile: Profile | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .schema(SHARED_SCHEMA)
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return { email: user.email ?? "", id: user.id, profile: (profile as Profile) ?? null };
}
