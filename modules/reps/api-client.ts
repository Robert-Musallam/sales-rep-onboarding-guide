/**
 * Typed client wrapper over the reps API routes (pattern from
 * gcv-renewals modules/renewals/api-client.ts). Every call returns the parsed
 * JSON or throws with the server's error message.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

export const repsApi = {
  create: (body: Record<string, unknown>) =>
    call<{ ok: true; id: number }>("/api/reps", { method: "POST", body: JSON.stringify(body) }),

  update: (id: number, patch: Record<string, unknown>) =>
    call<{ ok: true }>(`/api/reps/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  setStatus: (id: number, status: string) =>
    call<{ ok: true }>(`/api/reps/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),

  completeItem: (repId: number, itemId: number, action: "complete" | "reopen") =>
    call<{ ok: true; enqueued: number }>(`/api/reps/${repId}/checklist/${itemId}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  repLink: (repId: number) =>
    call<{ ok: true; url: string }>(`/api/reps/${repId}/link`, { method: "POST" }),

  retryOutbox: (outboxId: number) =>
    call<{ ok: true }>(`/api/outbox/${outboxId}/retry`, { method: "POST" }),
};
