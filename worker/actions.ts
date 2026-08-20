import { db, ONBOARDING, getSetting, logActivity } from "./db";
import { gate } from "./env";
import { ENV } from "./env";
import { renderTemplate } from "./templates";
import * as graph from "./connectors/graph";
import * as dialpad from "./connectors/dialpad";
import * as hcp from "./connectors/hcp";
import * as jotform from "./connectors/jotform";

/**
 * Outbox action handlers. Contract:
 *  - return {done: true, note} on success
 *  - return {skipped: true, note} when a send gate blocked it (dry-run / pilot)
 *  - throw to retry (the executor backs off and eventually fails the row)
 * Every handler is idempotent: it checks the rep row for already-done work
 * before touching the outside world.
 */
export type ActionResult = { done: true; note?: string } | { skipped: true; note: string };

interface Rep {
  id: number;
  first_name: string;
  last_name: string;
  personal_email: string | null;
  phone_e164: string | null;
  phone_os: string | null;
  manager_name: string | null;
  territory_id: number | null;
  rnb_email: string | null;
  m365_user_id: string | null;
  teams_chat_id: string | null;
  phone_room_chat_id: string | null;
  hcp_employee_id: string | null;
  jotform_info_submission_id: string | null;
  is_test: boolean;
  territory?: { name: string; post_sales_chat_ids: string[]; hcp_api_key_env: string | null } | null;
}

async function loadRep(repId: number): Promise<Rep> {
  const { data, error } = await db()
    .schema(ONBOARDING)
    .from("reps")
    .select("*, territory:territories(name, post_sales_chat_ids, hcp_api_key_env)")
    .eq("id", repId)
    .maybeSingle();
  if (error) throw new Error(`loadRep: ${error.message}`);
  if (!data) throw new Error(`rep ${repId} not found`);
  return data as unknown as Rep;
}

async function updateRep(repId: number, patch: Record<string, unknown>) {
  const { error } = await db().schema(ONBOARDING).from("reps").update(patch).eq("id", repId);
  if (error) throw new Error(`updateRep: ${error.message}`);
}

function repVars(rep: Rep): Record<string, string | null> {
  return {
    first_name: rep.first_name,
    last_name: rep.last_name,
    territory: rep.territory?.name ?? null,
    manager_name: rep.manager_name,
    rnb_email: rep.rnb_email,
    phone: rep.phone_e164,
    rep_url: `${ENV.appBaseUrl()}/reps?open=${rep.id}`,
  };
}

async function sendTemplatedSms(
  rep: Rep,
  templateKey: string,
  extraVars: Record<string, string> = {},
  toOverride?: string,
): Promise<ActionResult> {
  const to = toOverride ?? rep.phone_e164;
  if (!to) throw new Error(`rep ${rep.id} has no phone number`);
  const { body } = await renderTemplate(templateKey, { ...repVars(rep), ...extraVars });
  const verdict = gate("sms", to);
  if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would text ${to}: ${body.slice(0, 120)}…` };
  const from = (await getSetting<string>("dialpad_from_number")) ?? "";
  const dp = await dialpad.sendSms({ from, to, text: body });
  // Full message body + Dialpad response land on the timeline; the outbox row
  // keeps a compact receipt (shown in the drawer's Automations list).
  await logActivity(rep.id, "sms_sent", `Texted ${to} (${templateKey}): "${body}"`, {
    template_key: templateKey,
    to,
    from,
    body,
    dialpad: dp,
  });
  const receipt = `dialpad id ${dp.id ?? "?"}${dp.status ? ` · status ${dp.status}` : ""}`;
  // Every SMS that goes to a rep's own phone also gets copied to the ops number.
  // Only primary sends copy (toOverride sends are themselves copies/redirects),
  // which prevents a copy from copying itself.
  if (!toOverride) await sendSmsCopy(rep, templateKey, body);
  return { done: true, note: `→ ${to} (${templateKey}) · ${receipt}` };
}

/** last-10-digits comparison so +1XXXXXXXXXX and (XXX) XXX-XXXX match. */
function sameNumber(a?: string | null, b?: string | null): boolean {
  const da = (a ?? "").replace(/\D/g, "").slice(-10);
  const db = (b ?? "").replace(/\D/g, "").slice(-10);
  return da.length === 10 && da === db;
}

/**
 * Ops copy of any outbound SMS → app_settings.sms_copy_to (falls back to the
 * legacy gusto_sms_copy_to so this works before the new setting is seeded).
 * BEST-EFFORT: never throws. The primary SMS already sent; throwing here would
 * make the executor retry the whole action and re-text the rep.
 */
async function sendSmsCopy(rep: Rep, templateKey: string, body: string): Promise<void> {
  try {
    const copyTo =
      (await getSetting<string>("sms_copy_to")) ||
      (await getSetting<string>("gusto_sms_copy_to")) ||
      "";
    if (!copyTo) return;
    if (sameNumber(rep.phone_e164, copyTo)) return; // rep is the ops number — don't double-text
    const verdict = gate("sms", copyTo);
    if (!verdict.allowed) {
      await logActivity(rep.id, "sms_copy_skipped", `Ops copy to ${copyTo} skipped: ${verdict.reason}`, {
        to: copyTo,
        template_key: templateKey,
      });
      return;
    }
    const from = (await getSetting<string>("dialpad_from_number")) ?? "";
    const text = `[copy → ${rep.first_name} ${rep.last_name}] ${body}`;
    const dp = await dialpad.sendSms({ from, to: copyTo, text });
    await logActivity(rep.id, "sms_copy_sent", `Copied ${templateKey} SMS to ops ${copyTo}`, {
      to: copyTo,
      from,
      body: text,
      template_key: templateKey,
      dialpad: dp,
    });
  } catch (e) {
    await logActivity(rep.id, "sms_copy_failed", `Ops SMS copy failed: ${(e as Error).message}`).catch(() => {});
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const handlers: Record<string, (repId: number, payload: Record<string, unknown>) => Promise<ActionResult>> = {
  /** Intake: create the pre-filled Jotform rep-info submission, text the edit link. */
  "rep.invite": async (repId) => {
    const rep = await loadRep(repId);
    let submissionId = rep.jotform_info_submission_id;
    const verdict = gate("sms", rep.phone_e164 ?? "");
    if (!verdict.allowed) {
      return { skipped: true, note: `${verdict.reason} — would prefill Jotform + text invite to ${rep.phone_e164}` };
    }
    if (!submissionId) {
      const formId = (await getSetting<string>("jotform_info_form_id")) ?? "";
      // Prefill fields 41/42/43 (phone/first/last) — the exact fields the Make
      // scenario prefilled on the live "Onboarding Basic Information" form.
      const created = await jotform.createSubmission(formId, {
        "41": jotform.prettyPhone(rep.phone_e164),
        "42": rep.first_name,
        "43": rep.last_name,
      });
      submissionId = created.submissionId;
      await updateRep(repId, { jotform_info_submission_id: submissionId });
    }
    return sendTemplatedSms(rep, "sms.invite", {
      info_form_link: `https://www.jotform.com/edit/${submissionId}`,
    });
  },

  /**
   * Mirror the native /intake submission into the manager form
   * (261604930668664) so it remains the registration record. The edge function
   * recognizes mirrored submissions via the form_submissions row written here
   * and skips re-ingesting them.
   */
  "jotform.mirror_intake": async (repId) => {
    const rep = await loadRep(repId);
    const { data: existing } = await db()
      .schema(ONBOARDING)
      .from("form_submissions")
      .select("id")
      .eq("rep_id", repId)
      .eq("source", "native_mirror")
      .maybeSingle();
    if (existing) return { done: true, note: "already mirrored" };

    const formId = (await getSetting<string>("jotform_manager_form_id")) ?? "";
    if (!formId) throw new Error("app_settings.jotform_manager_form_id is empty");
    const fields: Record<string, string> = {
      "3_first": rep.first_name,
      "3_last": rep.last_name,
      "8": rep.territory?.name ?? "",
      "31": rep.manager_name ?? "",
      "32": jotform.prettyPhone(rep.phone_e164),
      "34": rep.personal_email ?? "",
      "35": "Design Consultant",
    };
    const start = (rep as unknown as { expected_start?: string | null }).expected_start;
    if (start) {
      const [y, m, d] = start.split("-");
      fields["36_month"] = String(Number(m));
      fields["36_day"] = String(Number(d));
      fields["36_year"] = y;
    }
    const { submissionId } = await jotform.createSubmission(formId, fields);
    const { error } = await db().schema(ONBOARDING).from("form_submissions").insert({
      source: "native_mirror",
      form_id: formId,
      submission_id: submissionId,
      rep_id: repId,
      payload: fields,
    });
    if (error) throw new Error(`mirror record: ${error.message}`);
    await logActivity(repId, "intake_mirrored", `Registration mirrored to Jotform (${submissionId})`);
    return { done: true, note: submissionId };
  },

  /**
   * Generic templated SMS (payload.template_key). Optional recipient override:
   * payload.to (explicit number) or payload.to_setting (app_settings key whose
   * value is the number — empty setting = quietly skip).
   */
  "sms.send": async (repId, payload) => {
    const rep = await loadRep(repId);
    let toOverride: string | undefined;
    if (payload.to) toOverride = String(payload.to);
    else if (payload.to_setting) {
      const v = (await getSetting<string>(String(payload.to_setting))) ?? "";
      if (!v) return { done: true, note: `copy skipped — app_settings.${payload.to_setting} is empty` };
      toOverride = v;
    }
    return sendTemplatedSms(rep, String(payload.template_key), {}, toOverride);
  },

  /** Teams notification into the notify chat when a rep submits their info form. */
  "teams.notify_info_submitted": async (repId) => {
    const rep = await loadRep(repId);
    const chatId = (await getSetting<string>("notify_chat_id")) ?? "";
    if (!chatId) throw new Error("app_settings.notify_chat_id is empty");
    const { body } = await renderTemplate("teams.notify_info_submitted", repVars(rep));
    const verdict = gate("teams");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would post info-submitted notice` };
    await graph.sendChatMessage(chatId, body);
    return { done: true };
  },

  /** Gusto checked → create the Microsoft user (replaces Make's addAMember w/ static password). */
  "m365.create_user": async (repId) => {
    const rep = await loadRep(repId);
    if (rep.m365_user_id) return { done: true, note: "user already created" };
    const verdict = gate("provision");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would create M365 user for ${rep.first_name} ${rep.last_name}` };
    const domain = (await getSetting<string>("rnb_email_domain")) ?? "rocknblocklandscape.com";
    const { userId, upn, tempPassword } = await graph.createUser({
      firstName: rep.first_name,
      lastName: rep.last_name,
      domain,
    });
    await updateRep(repId, {
      m365_user_id: userId,
      rnb_email: upn,
      m365_temp_password: tempPassword,
      status: "provisioning",
    });
    await logActivity(repId, "m365_user_created", `Created Microsoft user ${upn}`);
    return { done: true, note: upn };
  },

  /** License checked → 1:1 chat with the admin + welcome DM. */
  "teams.create_dm": async (repId) => {
    const rep = await loadRep(repId);
    if (!rep.m365_user_id) throw new Error("rep has no m365_user_id yet (create user first)");
    const verdict = gate("teams");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would create 1:1 chat + DM` };
    const adminUpn = (await getSetting<string>("admin_upn")) ?? "";
    let chatId = rep.teams_chat_id;
    if (!chatId) {
      chatId = await graph.createOneOnOneChat(adminUpn, rep.m365_user_id);
      await updateRep(repId, { teams_chat_id: chatId });
    }
    const { body } = await renderTemplate("teams.dm_welcome", repVars(rep));
    await graph.sendChatMessage(chatId, body);
    await logActivity(repId, "teams_dm_sent", "Created 1:1 Teams chat and sent welcome DM");
    return { done: true };
  },

  /** Phone Room group chat: static roster + territory-conditional people + admin + rep. */
  "teams.create_phone_room": async (repId) => {
    const rep = await loadRep(repId);
    if (!rep.m365_user_id) throw new Error("rep has no m365_user_id yet");
    if (rep.phone_room_chat_id) return { done: true, note: "phone room already exists" };
    const verdict = gate("teams");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would create Phone Room chat` };

    const { data: people } = await db()
      .schema(ONBOARDING)
      .from("people")
      .select("azure_user_id, territories")
      .eq("active", true)
      .contains("roles", ["phone_room_roster"]);
    const territory = rep.territory?.name ?? "";
    const rosterIds = (people ?? [])
      .filter((p) => p.azure_user_id)
      .filter((p) => !p.territories?.length || p.territories.includes(territory))
      .map((p) => p.azure_user_id as string);

    const adminUpn = (await getSetting<string>("admin_upn")) ?? "";
    const topic = `${rep.first_name} ${rep.last_name} - ${territory} - Phone Room`;
    const chatId = await graph.createGroupChat(topic, [adminUpn, rep.m365_user_id, ...rosterIds]);
    await updateRep(repId, { phone_room_chat_id: chatId });
    const { body } = await renderTemplate("teams.phone_room_welcome", repVars(rep));
    await graph.sendChatMessage(chatId, body);
    await logActivity(repId, "phone_room_created", `Created Phone Room (${rosterIds.length + 2} members)`);
    return { done: true };
  },

  /** Add the rep to their territory's post-sales chats. */
  "teams.add_territory_chats": async (repId) => {
    const rep = await loadRep(repId);
    if (!rep.m365_user_id) throw new Error("rep has no m365_user_id yet");
    const chatIds = rep.territory?.post_sales_chat_ids ?? [];
    if (!chatIds.length) return { done: true, note: "territory has no post-sales chats configured" };
    const verdict = gate("teams");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would add rep to ${chatIds.length} chats` };
    for (const chatId of chatIds) {
      await graph.addChatMember(chatId, rep.m365_user_id);
    }
    await logActivity(repId, "territory_chats_joined", `Added to ${chatIds.length} territory chat(s)`);
    return { done: true };
  },

  /** Keep public.employee_teams_chats fed — the Make "Dialpad" scenario reads it. */
  "compat.employee_teams_chats": async (repId) => {
    const rep = await loadRep(repId);
    if (!rep.teams_chat_id || !rep.phone_room_chat_id) {
      throw new Error("chat ids not ready yet (retry)");
    }
    const { data: existing } = await db()
      .from("employee_teams_chats")
      .select("id")
      .eq("chat_id", rep.teams_chat_id)
      .maybeSingle();
    if (existing) return { done: true, note: "compat row already present" };
    const { error } = await db().from("employee_teams_chats").insert({
      assigned_employee_first_name: rep.first_name,
      assigned_employee_last_name: rep.last_name,
      assigned_employee_email: rep.rnb_email,
      location: rep.territory?.name ?? null,
      chat_id: rep.teams_chat_id,
      phone_room_chat_id: rep.phone_room_chat_id,
    });
    if (error) throw new Error(`compat insert: ${error.message}`);
    return { done: true };
  },

  /** Company-wide welcome announcement. */
  "teams.company_announcement": async (repId) => {
    const rep = await loadRep(repId);
    const chatId = (await getSetting<string>("company_wide_chat_id")) ?? "";
    if (!chatId) throw new Error("app_settings.company_wide_chat_id is empty");
    const verdict = gate("teams");
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would post company-wide welcome` };
    const { body } = await renderTemplate("teams.company_announcement", repVars(rep));
    await graph.sendChatMessage(chatId, body);
    await logActivity(repId, "company_announcement", "Posted company-wide welcome");
    return { done: true };
  },

  /** Welcome email (configurable sender — never info.colorado). */
  "email.welcome": async (repId) => {
    const rep = await loadRep(repId);
    if (!rep.rnb_email) throw new Error("rep has no rnb_email yet");
    const sender = (await getSetting<string>("welcome_email_sender")) ?? "";
    if (!sender) throw new Error("app_settings.welcome_email_sender is empty — set it in Settings (SETUP.md §2)");
    const verdict = gate("email", rep.rnb_email);
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would email ${rep.rnb_email}` };
    const bcc = (await getSetting<string[]>("welcome_email_bcc")) ?? [];
    const { subject, body } = await renderTemplate("email.welcome", repVars(rep));
    await graph.sendMail({
      fromUpn: sender,
      to: [rep.rnb_email],
      cc: rep.personal_email ? [rep.personal_email] : [],
      bcc,
      subject,
      html: body,
    });
    await logActivity(repId, "welcome_email_sent", `Welcome email → ${rep.rnb_email} (cc ${rep.personal_email ?? "—"})`);
    return { done: true };
  },

  /** Teams/WhatsApp download SMS, variant by phone OS. */
  "sms.app_download": async (repId) => {
    const rep = await loadRep(repId);
    const key = (rep.phone_os ?? "").toLowerCase().includes("android")
      ? "sms.app_download_android"
      : "sms.app_download_ios";
    return sendTemplatedSms(rep, key);
  },

  /** HCP checked → create the employee in the territory's HCP company. */
  /**
   * HCP checked → VERIFY the employee exists in the territory's HCP company and
   * record its id. (The public HCP API cannot create employees — POST /employees
   * 404s, confirmed 2026-08-07. Creation stays manual in the HCP UI; a browser
   * agent can take it over later.)
   */
  "hcp.verify_employee": async (repId) => {
    const rep = await loadRep(repId);
    if (rep.hcp_employee_id) return { done: true, note: "HCP employee already verified" };
    const found = await hcp.findEmployee({
      apiKeyEnv: rep.territory?.hcp_api_key_env,
      territoryName: rep.territory?.name,
      email: rep.rnb_email,
      firstName: rep.first_name,
      lastName: rep.last_name,
    });
    if (!found) {
      throw new Error(
        `No employee matching ${rep.rnb_email ?? `${rep.first_name} ${rep.last_name}`} in the ${rep.territory?.name ?? "?"} HCP — create them in the HCP UI first, then Retry`,
      );
    }
    await updateRep(repId, { hcp_employee_id: found.id });
    await logActivity(
      repId,
      "hcp_user_verified",
      `Verified HCP employee ${found.id} (matched by ${found.matchedBy}${found.email ? `, ${found.email}` : ""})`,
    );
    return { done: true, note: `HCP ${found.id} · matched by ${found.matchedBy}` };
  },

  /** Business-card request email to the configured contact. */
  "email.business_cards": async (repId) => {
    const rep = await loadRep(repId);
    const contact = (await getSetting<string>("business_card_contact_email")) ?? "";
    if (!contact) throw new Error("app_settings.business_card_contact_email is empty — set it in Settings");
    const sender = (await getSetting<string>("welcome_email_sender")) ?? "";
    if (!sender) throw new Error("app_settings.welcome_email_sender is empty");
    const verdict = gate("email", contact);
    if (!verdict.allowed) return { skipped: true, note: `${verdict.reason} — would email ${contact}` };
    const { subject, body } = await renderTemplate("email.business_cards", repVars(rep));
    await graph.sendMail({ fromUpn: sender, to: [contact], subject, html: body.replace(/\n/g, "<br>") });
    await logActivity(repId, "business_cards_requested", `Business-card request → ${contact}`);
    return { done: true };
  },

  /** System-completes checklist items (welcome_message/team_channel/training). */
  "checklist.autocomplete": async (repId, payload) => {
    const keys = (payload.keys as string[]) ?? [];
    const { error } = await db()
      .schema(ONBOARDING)
      .from("checklist_items")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("rep_id", repId)
      .in("template_key", keys)
      .eq("status", "pending");
    if (error) throw new Error(`autocomplete: ${error.message}`);
    await logActivity(repId, "checklist_autocompleted", `Auto-completed: ${keys.join(", ")}`);
    return { done: true };
  },
};

export function getHandler(actionType: string) {
  return handlers[actionType] ?? null;
}
