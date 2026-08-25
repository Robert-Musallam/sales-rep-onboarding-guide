import { ActionError } from "@/lib/os/entity";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { outboxRowsFor } from "@/lib/onboarding/automations";

/**
 * Rep intake — shared by the two doors into it: the signed-in form at /intake
 * and the tokenized, login-free one at /intake/<token>.
 *
 * Both create exactly the same thing (rep + checklist + invite bundle); they
 * differ only in who is allowed through and where the territory comes from. The
 * logic lives here so a change to what "filing a rep" means can never apply to
 * one door and not the other.
 */

export interface IntakeFields {
  first_name: string;
  last_name: string;
  phone_e164: string;
  personal_email: string;
  territory_id: number;
  manager_name: string;
  expected_start: string;
  how_heard: string | null;
}

/**
 * Validate and normalize a submitted form. Territory is validated only when the
 * caller lets the form choose it: the tokenized door takes the territory from
 * the link and passes it in, so a tampered payload cannot move a rep to another
 * city.
 */
export function parseIntake(body: Record<string, unknown>, territoryOverride?: number): IntakeFields {
  const firstName = String(body.first_name ?? "").trim();
  const lastName = String(body.last_name ?? "").trim();
  if (!firstName || !lastName) throw new ActionError("First and last name are required");

  const phone = String(body.phone ?? "").replace(/\D/g, "");
  if (phone.length !== 10 && phone.length !== 11) throw new ActionError("Phone must be 10 digits");

  const personalEmail = String(body.personal_email ?? "").trim();
  if (!personalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
    throw new ActionError("A valid personal email is required");
  }

  const territoryId = territoryOverride ?? Number(body.territory_id);
  if (!territoryId) throw new ActionError("Territory is required");

  const managerName = String(body.manager_name ?? "").trim();
  if (!managerName) throw new ActionError("Hiring manager is required");

  const expectedStart = String(body.expected_start ?? "").trim();
  if (!expectedStart) throw new ActionError("Expected start date is required");
  if (expectedStart < new Date().toISOString().slice(0, 10)) {
    throw new ActionError("Expected start date cannot be in the past");
  }

  return {
    first_name: firstName,
    last_name: lastName,
    phone_e164: `+1${phone.slice(-10)}`,
    personal_email: personalEmail,
    territory_id: territoryId,
    manager_name: managerName,
    expected_start: expectedStart,
    how_heard: (body.how_heard as string)?.trim() || null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any;

/**
 * Create the rep, instantiate their checklist from the active template, and
 * queue the invite bundle. Returns the new rep id.
 *
 * `createdBy` is the signed-in user when there is one; `intakeLinkId` records
 * the city link a login-free submission came through, so every rep can be
 * traced back to the door it entered by.
 */
export async function createRepFromIntake(
  supabase: AnyClient,
  fields: IntakeFields,
  provenance: { createdBy?: string | null; intakeLinkId?: number | null } = {},
): Promise<number> {
  const { data: rep, error } = await supabase
    .schema(ONBOARDING_SCHEMA)
    .from("reps")
    .insert({
      first_name: fields.first_name,
      last_name: fields.last_name,
      phone_e164: fields.phone_e164,
      personal_email: fields.personal_email,
      manager_name: fields.manager_name,
      how_heard: fields.how_heard,
      expected_start: fields.expected_start,
      territory_id: fields.territory_id,
      created_by: provenance.createdBy ?? null,
      intake_link_id: provenance.intakeLinkId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new ActionError(error.message, 500);
  const repId = rep.id as number;

  const { data: templates, error: tErr } = await supabase
    .schema(ONBOARDING_SCHEMA)
    .from("checklist_templates")
    .select("key, label, sort_order, automation_key")
    .eq("active", true)
    .order("sort_order");
  if (tErr) throw new ActionError(tErr.message, 500);
  if (templates?.length) {
    const { error: iErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("checklist_items")
      .insert(
        templates.map((t: Record<string, unknown>) => ({
          rep_id: repId,
          template_key: t.key,
          label: t.label,
          sort_order: t.sort_order,
          automation_key: t.automation_key,
        })),
      );
    if (iErr) throw new ActionError(iErr.message, 500);
  }

  const rows = outboxRowsFor("intake_submitted", repId);
  if (rows.length) {
    const { error: oErr } = await supabase
      .schema(ONBOARDING_SCHEMA)
      .from("outbox")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (oErr) throw new ActionError(oErr.message, 500);
  }

  return repId;
}

/**
 * Managers offered by a city's form: the ones mapped to that territory first,
 * everyone else under a fallback heading.
 *
 * The mapping (people rows with the "manager" role) is deliberately incomplete —
 * only the assignments the reps' own history supports are seeded — so the
 * fallback is what keeps a city with no mapped manager usable.
 */
export function splitManagersByTerritory(
  allManagers: string[],
  mapped: Array<{ full_name: string; territories: string[] }>,
  territory: string,
): { forCity: string[]; others: string[] } {
  const cityNames = new Set(
    mapped
      .filter((m) => !m.territories?.length || m.territories.includes(territory))
      .map((m) => m.full_name.toLowerCase()),
  );
  const forCity = allManagers.filter((m) => cityNames.has(m.toLowerCase()));
  const others = allManagers.filter((m) => !cityNames.has(m.toLowerCase()));
  return { forCity, others };
}
