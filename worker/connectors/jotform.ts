import { ENV } from "../env";

/**
 * Jotform connector. Used for ONE thing in the new system: creating a
 * pre-filled submission in the rep-info form so the rep gets an edit link by
 * SMS (exactly what the Make scenario did). The webhook INGESTS submissions via
 * the Supabase edge function, not this module.
 */
export async function createPrefilledSubmission(
  formId: string,
  fields: Record<string, string>,
): Promise<{ submissionId: string; editLink: string }> {
  const body = new URLSearchParams();
  for (const [qid, value] of Object.entries(fields)) {
    body.set(`submission[${qid}]`, value);
  }
  const res = await fetch(`${ENV.jotformBaseUrl()}/form/${formId}/submissions?apiKey=${ENV.jotformApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`jotform createSubmission: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { content?: { submissionID?: string } };
  const submissionId = j.content?.submissionID;
  if (!submissionId) throw new Error(`jotform createSubmission: no submissionID in ${JSON.stringify(j)}`);
  return { submissionId, editLink: `https://www.jotform.com/edit/${submissionId}` };
}

/** Credential check for scripts/verify_jotform.ts. */
export async function whoAmI(): Promise<string> {
  const res = await fetch(`${ENV.jotformBaseUrl()}/user?apiKey=${ENV.jotformApiKey()}`);
  if (!res.ok) throw new Error(`jotform user: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { content?: { username?: string } };
  return j.content?.username ?? "unknown";
}
