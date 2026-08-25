import { db, ONBOARDING, getSetting, logActivity } from "./db";
import * as graph from "./connectors/graph";

/**
 * Watchers: sweeps whose trigger is an external signal rather than the clock.
 *
 * Right now there is one — the Gusto contract signature. Gusto has no webhook
 * and sends no mail that says "signed"; the one observable event is the notice
 * that lands in the admin inbox when a contractor finishes setting up their
 * account: "<Name> from <Company> can now be paid". That mail is the signature.
 *
 * Same contract as the sweeps: runs every pass, enqueues outbox rows, and the
 * queue owns delivery, retry and the send gate. Re-running is a no-op — every
 * mail is recorded by its own message id in `gusto_signature_events`.
 */

const SUBJECT = /^(.+?)\s+from\s+(.+?)\s+can now be paid\s*$/i;

/** Lowercase, unaccented, punctuation-free — for comparing human names. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does the name Gusto used refer to this rep?
 *
 * Last name must match outright. First names are compared by prefix, because
 * Gusto carries whatever the rep typed into their own profile and reps shorten
 * their names there: the mail that prompted this feature said "Phil Carver" for
 * the rep the app knows as "Philip Carver".
 */
export function nameMatches(gustoName: string, first: string, last: string): boolean {
  const parts = norm(gustoName).split(" ");
  if (parts.length < 2) return false;
  const gLast = parts[parts.length - 1];
  const gFirst = parts[0];
  const rLast = norm(last);
  const rFirst = norm(first);
  if (!gLast || !rLast || gLast !== rLast) return false;
  return gFirst === rFirst || gFirst.startsWith(rFirst) || rFirst.startsWith(gFirst);
}

/**
 * Gusto's company names ("Rock n block arizona", "Rock n block florida llc")
 * are per-entity, not per-territory, so they only ever break a tie between two
 * reps who share a surname — never used to reject an otherwise clean match.
 */
function companyHints(company: string, territory: string | null): boolean {
  if (!territory) return false;
  const c = norm(company);
  const t = norm(territory);
  if (c.includes(t)) return true;
  // Florida is one Gusto entity; the app calls that territory Tampa.
  if (t === "tampa" && c.includes("florida")) return true;
  return false;
}

interface RepRow {
  id: number;
  first_name: string;
  last_name: string;
  status: string;
  territory?: { name: string } | null;
}

/** The rep this signature belongs to, or why it could not be pinned down. */
export function matchRep(
  reps: RepRow[],
  gustoName: string,
  company: string,
): { rep: RepRow | null; note: string } {
  const byName = reps.filter((r) => nameMatches(gustoName, r.first_name, r.last_name));
  if (byName.length === 1) return { rep: byName[0], note: "matched by name" };
  if (byName.length === 0) return { rep: null, note: `no rep matches "${gustoName}"` };
  const byTerritory = byName.filter((r) => companyHints(company, r.territory?.name ?? null));
  if (byTerritory.length === 1) return { rep: byTerritory[0], note: "matched by name + company" };
  return {
    rep: null,
    note: `"${gustoName}" matches ${byName.length} reps (${byName.map((r) => r.id).join(", ")}) — ambiguous`,
  };
}

/**
 * Read the admin inbox for Gusto signature notices and enqueue one
 * `rep.gusto_signed` action per new mail.
 *
 * The cursor is a watermark, not a guarantee: it is re-read with a small
 * overlap and duplicates are cut by the unique message id, so a mail that
 * arrives while a pass is mid-flight is never lost.
 */
export async function watchGustoSignatures(): Promise<void> {
  if ((await getSetting<boolean>("gusto_signature_watch_enabled", true)) === false) return;
  const mailbox =
    (await getSetting<string>("gusto_signature_mailbox")) || (await getSetting<string>("admin_upn")) || "";
  if (!mailbox) return;
  const sender = ((await getSetting<string>("gusto_signature_sender")) ?? "gustonoreply@gusto.com").toLowerCase();
  const cursor = (await getSetting<string>("gusto_signature_cursor")) ?? new Date().toISOString();
  const OVERLAP_MS = 10 * 60_000;
  const since = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();

  const messages = (await graph.listInboxSince(mailbox, since)).filter((m) => m.from === sender);
  const signatures = messages
    .map((m) => ({ m, parsed: SUBJECT.exec(m.subject) }))
    .filter((x) => x.parsed);

  // The watermark moves over everything read, not just the signatures — payroll
  // noise from the same sender must not be re-read on every pass.
  const newest = messages.length ? messages[messages.length - 1].receivedDateTime : null;

  if (signatures.length) {
    const { data: reps, error } = await db()
      .schema(ONBOARDING)
      .from("reps")
      .select("id, first_name, last_name, status, territory:territories(name)")
      .neq("status", "inactive");
    if (error) throw new Error(`reps: ${error.message}`);

    for (const { m, parsed } of signatures) {
      const gustoName = parsed![1].trim();
      const company = parsed![2].trim();
      const { rep, note } = matchRep((reps ?? []) as unknown as RepRow[], gustoName, company);

      const { data: inserted, error: iErr } = await db()
        .schema(ONBOARDING)
        .from("gusto_signature_events")
        .upsert(
          {
            internet_message_id: m.internetMessageId,
            graph_message_id: m.id,
            subject: m.subject,
            received_at: m.receivedDateTime,
            gusto_name: gustoName,
            gusto_company: company,
            rep_id: rep?.id ?? null,
            matched: Boolean(rep),
            note,
          },
          { onConflict: "internet_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (iErr) throw new Error(`gusto_signature_events: ${iErr.message}`);
      if (!inserted?.length) continue; // already handled by an earlier pass

      if (!rep) {
        // Nothing to check and nobody to attribute it to: leave it on the
        // record and let the health panel / logs surface it.
        console.warn(`gusto signature unmatched: ${m.subject} — ${note}`);
        continue;
      }

      const { error: oErr } = await db()
        .schema(ONBOARDING)
        .from("outbox")
        .upsert(
          [
            {
              action_type: "rep.gusto_signed",
              rep_id: rep.id,
              payload: { gusto_name: gustoName, gusto_company: company, subject: m.subject },
              dedupe_key: `gusto_signed:${m.internetMessageId}`,
            },
          ],
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        );
      if (oErr) throw new Error(`outbox: ${oErr.message}`);
      await logActivity(rep.id, "gusto_signature_detected", `Gusto: "${m.subject}" (${note})`, {
        subject: m.subject,
        received_at: m.receivedDateTime,
      });
    }
  }

  if (newest && Date.parse(newest) > Date.parse(cursor)) {
    await db()
      .schema(ONBOARDING)
      .from("app_settings")
      .update({ value: newest })
      .eq("key", "gusto_signature_cursor");
  }
}
