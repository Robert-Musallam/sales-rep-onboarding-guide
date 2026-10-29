/**
 * Hand each city manager their intake link, by Teams DM from Robert's account.
 *
 *   npx tsx scripts/intake_links_dm.ts                 # dry run: resolves users, prints both messages, sends nothing
 *   npx tsx scripts/intake_links_dm.ts --send          # sends to every manager listed below
 *   npx tsx scripts/intake_links_dm.ts --send --only=cguzman@rocknblocklandscape.com
 *   npx tsx scripts/intake_links_dm.ts --send --chat=<chatId> --city="Las Vegas" --name=Jose
 *       (an EXISTING chat, e.g. with an external person Graph cannot create a chat with)
 *
 * Two messages per manager, on purpose: the instructions, then the link on
 * its own — shown as "New Design Consultant – <City>" with the real URL behind
 * it — which is then pinned in the chat so it stays at the top. Chats are 1:1 Robert ↔ manager
 * (find-or-create, app token); the messages are sent with the delegated token,
 * which is what Graph requires for chat messages — they come from Robert.
 *
 * Recipients are the active managers in onboarding.people (role "manager")
 * whose territory has an active intake link, plus OVERRIDES for a city whose
 * person in charge is not filed as a manager there. Robert's own city is
 * skipped unless --only names him.
 */
import { db, ONBOARDING } from "../worker/db";
import { createOneOnOneChat, findUserByUpn, pinChatMessage, sendChatMessage } from "../worker/connectors/graph";

const BASE = "https://gcv-renewals.vercel.app";
const SELF = "rmusallam@rocknblocklandscape.com";
/** City → UPN when the person in charge is not a "manager" row for that city in People. */
const OVERRIDES: Record<string, string> = { Tampa: "cfaronea@rocknblocklandscape.com" };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const send = process.argv.includes("--send");
const only = (arg("only") ?? "").toLowerCase();

function instructions(firstName: string, city: string): string {
  return [
    `<p>Hi ${firstName},</p>`,
    `<p>Here's your link to start onboarding a new Design Consultant for ${city}:</p>`,
    `<p><b>How to use it</b><br>`,
    `1. Open the link (no login needed).<br>`,
    `2. Fill in the rep's name, cell phone, personal email, hiring manager and expected start date. The city is already set to ${city}.<br>`,
    `3. Tap "Start onboarding".</p>`,
  ].join("");
}

interface Target { city: string; token: string; upn: string; firstName: string; lastName: string }

async function targets(): Promise<Target[]> {
  const s = db().schema(ONBOARDING);
  const links = await s.from("intake_links").select("token, active, territory:territories(name, active)").eq("active", true);
  if (links.error) throw links.error;
  const people = await s.from("people").select("full_name, email, roles, territories").eq("active", true);
  if (people.error) throw people.error;
  const managers = (people.data ?? []).filter((p) => (p.roles ?? []).includes("manager") && p.email);
  const out: Target[] = [];
  for (const l of links.data ?? []) {
    const t = l.territory as unknown as { name: string; active: boolean } | null;
    if (!t?.active) continue;
    const upns = OVERRIDES[t.name]
      ? [OVERRIDES[t.name]]
      : managers.filter((p) => (p.territories ?? []).includes(t.name)).map((p) => String(p.email).toLowerCase());
    for (const upn of upns) {
      const row = (people.data ?? []).find((p) => String(p.email ?? "").toLowerCase() === upn);
      const full = row?.full_name ?? (await directoryName(upn)) ?? upn;
      const [firstName, ...rest] = full.split(" ");
      out.push({ city: t.name, token: l.token, upn, firstName, lastName: rest.join(" ") });
    }
  }
  return out.sort((a, b) => a.city.localeCompare(b.city));
}

async function directoryName(upn: string): Promise<string | null> {
  const r = await db().schema(ONBOARDING).from("directory_people").select("full_name").ilike("email", upn).limit(1).maybeSingle();
  return (r.data?.full_name as string | undefined) ?? null;
}

(async () => {
  const chatArg = arg("chat");
  if (chatArg) {
    const city = arg("city") ?? "";
    const firstName = arg("name") ?? "";
    if (!city || !firstName) throw new Error("--chat needs --city and --name");
    const l = await db().schema(ONBOARDING).from("intake_links").select("token, territory:territories!inner(name)").eq("active", true).eq("territory.name", city).maybeSingle();
    if (l.error || !l.data) throw new Error(`no active intake link for ${city}`);
    const link = `${BASE}/intake/${l.data.token}`;
    const label = `New Design Consultant – ${city}`;
    console.log(`${city} → chat ${chatArg} (${firstName})${send ? " — SENDING" : " — dry run"}`);
    console.log(`  message 1: ${instructions(firstName, city).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    console.log(`  message 2: [${label}] → ${link.slice(0, BASE.length + 20)}…  (pinned)`);
    if (send) {
      const m1 = await sendChatMessage(chatArg, instructions(firstName, city));
      const m2 = await sendChatMessage(chatArg, `<p><a href="${link}">${label}</a></p>`);
      try {
        await pinChatMessage(chatArg, m2.id);
        console.log(`  sent: messages ${m1.id}, ${m2.id} (pinned)`);
      } catch (e) {
        console.log(`  sent: messages ${m1.id}, ${m2.id}; PIN FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
    return;
  }
  const all = await targets();
  const list = all.filter((t) => (only ? t.upn === only : t.upn !== SELF));
  const skipped = all.filter((t) => !list.includes(t));
  console.log(`${list.length} recipient(s)${send ? " — SENDING" : " — dry run, nothing sent"}; skipped: ${skipped.map((s) => `${s.city} (${s.upn})`).join(", ") || "none"}`);

  const me = await findUserByUpn(SELF);
  if (!me) throw new Error(`cannot resolve ${SELF}`);

  for (const t of list) {
    const user = await findUserByUpn(t.upn);
    const link = `${BASE}/intake/${t.token}`;
    console.log(`\n${t.city}: ${t.firstName} ${t.lastName} <${t.upn}> ${user ? "✓ in Entra" : "✗ NOT FOUND in Entra"}`);
    console.log(`  message 1: ${instructions(t.firstName, t.city).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    const label = `New Design Consultant – ${t.city}`;
    console.log(`  message 2: [${label}] → ${link.slice(0, BASE.length + 20)}…  (pinned)`);
    if (!send || !user) continue;
    // A test send to Robert himself goes to his own notes chat: Graph has no 1:1 chat with one member.
    const chatId = user.id === me.id ? "48:notes" : await createOneOnOneChat(me.id, user.id);
    const m1 = await sendChatMessage(chatId, instructions(t.firstName, t.city));
    const m2 = await sendChatMessage(chatId, `<p><a href="${link}">${label}</a></p>`);
    await pinChatMessage(chatId, m2.id);
    console.log(`  sent: chat ${chatId} messages ${m1.id}, ${m2.id} (pinned)`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
