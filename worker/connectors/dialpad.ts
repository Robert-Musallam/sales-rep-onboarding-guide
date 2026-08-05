import { ENV } from "../env";

/**
 * Dialpad SMS transport — TS port of the leasing daemon's dialpad_sender.py.
 * Callers must pass a gate() verdict check BEFORE calling send (the worker's
 * action layer owns gating + dry-run logging; this module just sends).
 */
export class DialpadSendError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 11) return `+${digits}`;
  throw new DialpadSendError(`cannot normalize phone number: ${raw}`);
}

export async function sendSms(opts: { from: string; to: string; text: string }): Promise<{ id?: string }> {
  const res = await fetch(`${ENV.dialpadBaseUrl()}/sms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.dialpadApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from_number: opts.from,
      to_numbers: [toE164(opts.to)],
      text: opts.text,
    }),
  });
  if (!res.ok) {
    throw new DialpadSendError(`dialpad sms: ${res.status} ${await res.text()}`, res.status);
  }
  return (await res.json().catch(() => ({}))) as { id?: string };
}
