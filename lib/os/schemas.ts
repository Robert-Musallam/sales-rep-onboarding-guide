/**
 * Postgres schemas the app reads/writes. Queries are schema-aware PER CALL
 * (`.schema(...)`) — we deliberately do NOT set a client-wide default schema.
 *
 * All three schemas must be listed under "Exposed schemas" in the Supabase
 * project's API settings (see SETUP.md) or PostgREST will 404 them.
 */
export const ONBOARDING_SCHEMA = "onboarding";
export const TRAINING_SCHEMA = "training";
export const SHARED_SCHEMA = "shared";
