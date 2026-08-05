import { createClient } from "@/lib/os/supabase/server";

export type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Typed error carrying an HTTP status for Route Handlers to surface. */
export class ActionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Resolve the acting user (email) or throw 401. Uses the RLS-scoped client. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ActionError("Not authenticated", 401);
  return { supabase, email: user.email ?? "unknown", id: user.id };
}

/** Load a single row from `schema.table` by id, or throw 404. Generic across modules. */
export async function loadEntity(supabase: ServerClient, schema: string, table: string, id: number) {
  const { data, error } = await supabase.schema(schema).from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new ActionError(error.message, 500);
  if (!data) throw new ActionError("Not found", 404);
  return data;
}

/**
 * Insert one activity row into `schema.table`. Non-fatal — logs and continues on
 * failure so a logging hiccup never breaks the primary mutation.
 *
 * NOTE: `renewals.renewal_activity` is no longer a table — it is a compatibility
 * VIEW over the shared audit primitive `shared.entity_activity`, and writes flow
 * through an INSTEAD OF INSERT trigger (`shared.renewal_activity_insert`) that maps
 * the legacy row shape onto entity_activity (resolves actor email → profile id,
 * folds `channel` into payload). The trigger writes the generated id + timestamp
 * back onto the row, so `.insert(row).select()` returns the persisted row correctly
 * — but this seam only inserts (no `.select()`) since callers ignore the result.
 * New OS modules should write `shared.entity_activity` directly rather than adding
 * another per-module activity table/view.
 */
export async function logEntityActivity(
  supabase: ServerClient,
  schema: string,
  table: string,
  row: Record<string, unknown>,
) {
  const { error } = await supabase.schema(schema).from(table).insert(row);
  if (error) console.error("activity log failed:", error.message);
}
