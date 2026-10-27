/**
 * Who would be greeted on a date, without posting anything.
 *
 *   npx tsx scripts/greetings_dry_run.ts --date=2026-11-09
 *   npx tsx scripts/greetings_dry_run.ts --date=2026-11-09 --check-chat
 *
 * --check-chat also reads the target chat's members through Graph (delegated,
 * as Robert) to confirm the account can post there. Nothing is written.
 */
import { getSetting } from "../worker/db";
import { greetingsFor, loadPeople } from "../worker/greetings";
import { getDelegatedToken } from "../worker/connectors/graph";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

(async () => {
  const date = arg("date") ?? new Date().toISOString().slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  const titles = (await getSetting<string[]>("greetings_job_titles")) ?? undefined;
  const people = await loadPeople();
  const due = greetingsFor(people, { year, month, day }, titles);
  console.log(`${date}: ${people.length} active employees read, ${due.length} greeting(s) due`);
  for (const g of due) {
    console.log(`  ${g.kind.padEnd(11)} ${g.person.full_name} (${g.person.job_title ?? "—"}, ${g.person.office ?? "—"})${g.kind === "anniversary" ? ` — ${g.years} year(s)` : ""}`);
  }
  if (process.argv.includes("--check-chat")) {
    const chatId = ((await getSetting<string>("greetings_chat_id")) ?? "").trim();
    const token = await getDelegatedToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}?$expand=members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = (await res.json()) as { chatType?: string; topic?: string; members?: Array<{ displayName?: string; email?: string }>; error?: unknown };
    if (!res.ok) throw new Error(`chat lookup ${res.status}: ${JSON.stringify(j.error).slice(0, 200)}`);
    console.log(`chat: type ${j.chatType}, topic ${JSON.stringify(j.topic ?? null)}, ${j.members?.length ?? 0} members`);
    for (const m of j.members ?? []) console.log(`  - ${m.displayName ?? "?"} <${m.email ?? "?"}>`);
  }
})().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
