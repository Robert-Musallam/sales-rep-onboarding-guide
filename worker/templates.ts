import { readFileSync } from "node:fs";
import path from "node:path";
import { getTemplate } from "./db";

/**
 * {{snake_case}} token rendering for message templates. Unknown tokens render
 * as empty string (never leak the raw token to a rep). Bodies beginning with
 * `@file:` load from worker/templates/<name> — used for the big welcome-email
 * HTML so it stays reviewable in the repo.
 */
export function render(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, k: string) => vars[k] ?? "");
}

export async function renderTemplate(
  key: string,
  vars: Record<string, string | null | undefined>,
): Promise<{ subject: string; body: string }> {
  const t = await getTemplate(key);
  if (!t) throw new Error(`message template not found: ${key}`);
  let body = t.body;
  if (body.startsWith("@file:")) {
    body = readFileSync(path.join(__dirname, "templates", body.slice(6)), "utf8");
  }
  return { subject: render(t.subject ?? "", vars), body: render(body, vars) };
}
