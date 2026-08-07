import { ENV } from "../env";

/**
 * Jotform connector. Creates/updates submissions via the API:
 *  - rep-info form prefill (fields 41=phone, 42=first, 43=last — same fields
 *    the Make scenario used) so the rep gets an edit link by SMS
 *  - manager-form mirror so form 261604930668664 stays the registration record
 * Ingestion happens in the Supabase edge function, not here.
 */
async function post(path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(`submission[${k}]`, v);
  const res = await fetch(`${ENV.jotformBaseUrl()}${path}?apiKey=${ENV.jotformApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`jotform ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function createSubmission(
  formId: string,
  fields: Record<string, string>,
): Promise<{ submissionId: string; editLink: string }> {
  const j = await post(`/form/${formId}/submissions`, fields);
  const submissionId = (j.content as { submissionID?: string })?.submissionID;
  if (!submissionId) throw new Error(`jotform createSubmission: no submissionID in ${JSON.stringify(j)}`);
  return { submissionId, editLink: `https://www.jotform.com/edit/${submissionId}` };
}

export async function updateSubmission(submissionId: string, fields: Record<string, string>): Promise<void> {
  await post(`/submission/${submissionId}`, fields);
}

/** "(408) 410-5938" from an E.164/raw phone — matches what the forms display. */
export function prettyPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (raw ?? "");
}

/** Credential check for scripts/verify_jotform.ts. */
export async function whoAmI(): Promise<string> {
  const res = await fetch(`${ENV.jotformBaseUrl()}/user?apiKey=${ENV.jotformApiKey()}`);
  if (!res.ok) throw new Error(`jotform user: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { content?: { username?: string } };
  return j.content?.username ?? "unknown";
}
