/**
 * Retry a Supabase write that fails on a transient Postgres lock/timeout.
 *
 * The Codex leasing daemon syncs ~400 rows across the leasing tables every 5 minutes
 * inside a single transaction, and it `on conflict do update` on all guest_card_approvals
 * rows — so for the few seconds that push runs it holds write locks on every approval.
 * A human Approve/Reject (an UPDATE on that same table) landing in that window waits on
 * the lock and gets canceled by the `authenticator` role's 8s statement/lock timeout,
 * surfacing as "canceling statement due to statement timeout". Retrying rides out the
 * push window (the table is unlocked ~98% of each interval).
 *
 * Only writers need this — plain SELECTs don't block on row locks under MVCC.
 */
type DbErr = { code?: string; message?: string } | null;

export function isTransientDbError(err: DbErr): boolean {
  if (!err) return false;
  // 57014 statement_timeout · 55P03 lock_not_available · 40P01 deadlock · 40001 serialization
  if (["57014", "55P03", "40P01", "40001"].includes(err.code ?? "")) return true;
  const m = (err.message ?? "").toLowerCase();
  return (
    m.includes("statement timeout") ||
    m.includes("lock timeout") ||
    m.includes("canceling statement") ||
    m.includes("lock_not_available") ||
    m.includes("deadlock")
  );
}

/**
 * Runs `op` (a Supabase query returning `{ error }`) up to `tries` times, backing off
 * between attempts only while the error is a transient lock/timeout. Returns the last
 * result either way, so callers keep their existing `{ data, error }` handling.
 */
export async function withDbRetry<T extends { error: DbErr }>(
  op: () => PromiseLike<T>,
  { tries = 3, baseDelayMs = 300 }: { tries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let res = await op();
  for (let attempt = 1; attempt < tries && res.error && isTransientDbError(res.error); attempt++) {
    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    res = await op();
  }
  return res;
}
