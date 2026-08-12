// Supabase Edge Function: jotform-webhook
// The single ingestion point for BOTH Jotform forms (routed by formID, exactly
// like the Make scenario's router):
//   • Manager form 261604930668664 — a manager used the classic registration
//     link: create the rep + checklist + queue the invite (parity with /intake).
//     Mirrored submissions the app itself created are recognized via
//     onboarding.form_submissions (source=native_mirror) and skipped.
//   • Rep-info form 261665616138664 — the rep completed their details: update
//     the rep, flip to info_submitted, queue notify + gusto SMS.
//
// Deploy:  supabase functions deploy jotform-webhook --no-verify-jwt
// Wire:    each form → Settings → Integrations → WebHooks →
//          https://<project>.supabase.co/functions/v1/jotform-webhook?key=<JOTFORM_WEBHOOK_SECRET>
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function digits10(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

function dateFrom(obj: unknown): string | null {
  const d = obj as { month?: string; day?: string; year?: string } | undefined;
  if (!d?.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

async function getSetting(key: string): Promise<string> {
  const { data } = await supabase.schema("onboarding").from("app_settings").select("value").eq("key", key).maybeSingle();
  return data ? String(data.value).replace(/^"|"$/g, "") : "";
}

async function instantiateChecklist(repId: number) {
  const { data: templates } = await supabase
    .schema("onboarding")
    .from("checklist_templates")
    .select("key, label, sort_order, automation_key")
    .eq("active", true)
    .order("sort_order");
  if (templates?.length) {
    await supabase
      .schema("onboarding")
      .from("checklist_items")
      .upsert(
        templates.map((t) => ({
          rep_id: repId,
          template_key: t.key,
          label: t.label,
          sort_order: t.sort_order,
          automation_key: t.automation_key,
        })),
        { onConflict: "rep_id,template_key", ignoreDuplicates: true },
      );
  }
}

async function enqueue(rows: Array<Record<string, unknown>>) {
  await supabase.schema("onboarding").from("outbox").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
}

async function logActivity(repId: number, action: string, summary: string) {
  await supabase.schema("shared").from("entity_activity").insert({
    entity_type: "rep",
    entity_id: String(repId),
    actor_type: "system",
    actor_label: "jotform-webhook",
    action,
    summary,
  });
}

// ── Manager registration form ────────────────────────────────────────────────
async function handleManagerForm(submissionId: string, raw: Record<string, unknown>): Promise<string> {
  // Mirror of an /intake the app already processed? (the worker's
  // jotform.mirror_intake action records source=native_mirror; the generic
  // audit row inserted by the entry point uses source=jotform_manager, so
  // filtering on source distinguishes them)
  const { data: known } = await supabase
    .schema("onboarding")
    .from("form_submissions")
    .select("id")
    .eq("submission_id", submissionId)
    .eq("source", "native_mirror")
    .maybeSingle();
  if (known) return "ok (mirror of native intake)";

  const name = (raw["q3_fullName3"] ?? {}) as { first?: string; last?: string };
  const phone = digits10((raw["q32_phoneNumber"] as { full?: string })?.full);
  if (!name.first || !phone) return "ignored (no name/phone)";

  // Race guard: /intake rep created moments ago with the same phone.
  const { data: recent } = await supabase
    .schema("onboarding")
    .from("reps")
    .select("id, phone_e164, created_at")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if ((recent ?? []).some((r) => digits10(r.phone_e164) === phone)) return "ok (recent duplicate)";

  const territoryName = String(raw["q8_howDid8"] ?? "");
  const { data: territory } = await supabase
    .schema("onboarding")
    .from("territories")
    .select("id")
    .eq("name", territoryName)
    .maybeSingle();

  const { data: rep, error } = await supabase
    .schema("onboarding")
    .from("reps")
    .insert({
      first_name: name.first,
      last_name: name.last ?? "",
      phone_e164: `+1${phone}`,
      personal_email: String(raw["q34_email"] ?? "") || null,
      manager_name: String(raw["q31_manager"] ?? "") || null,
      territory_id: territory?.id ?? null,
      expected_start: dateFrom(raw["q36_expectedStart"]),
      info: raw,
    })
    .select("id")
    .single();
  if (error) throw new Error(`rep insert: ${error.message}`);

  await supabase
    .schema("onboarding")
    .from("form_submissions")
    .update({ rep_id: rep.id })
    .eq("submission_id", submissionId);
  await instantiateChecklist(rep.id);
  // Invite only — no mirror (this intake already lives in the manager form).
  await enqueue([
    { action_type: "rep.invite", rep_id: rep.id, payload: {}, dedupe_key: `intake_submitted:rep.invite:${rep.id}` },
  ]);
  await logActivity(rep.id, "rep_created", `Registration via Jotform manager form (${name.first} ${name.last ?? ""})`);
  return "ok (rep created)";
}

// ── Rep info form ────────────────────────────────────────────────────────────
async function handleInfoForm(submissionId: string, raw: Record<string, unknown>): Promise<string> {
  const phoneRaw = (raw["q41_phoneNumber"] as { full?: string })?.full ?? "";

  let rep: { id: number } | null = null;
  {
    const { data } = await supabase
      .schema("onboarding")
      .from("reps")
      .select("id")
      .eq("jotform_info_submission_id", submissionId)
      .maybeSingle();
    rep = data;
  }
  if (!rep && phoneRaw) {
    const { data } = await supabase
      .schema("onboarding")
      .from("reps")
      .select("id, phone_e164")
      .not("phone_e164", "is", null)
      .order("created_at", { ascending: false });
    rep = (data ?? []).find((r) => digits10(r.phone_e164) === digits10(phoneRaw)) ?? null;
  }
  if (!rep) return "ok (unmatched)";

  const patch: Record<string, unknown> = {
    status: "info_submitted",
    jotform_info_submission_id: submissionId,
    info: raw,
  };
  if (raw["q42_firstName"]) patch.first_name = String(raw["q42_firstName"]);
  if (raw["q43_lastName"]) patch.last_name = String(raw["q43_lastName"]);
  if (phoneRaw) patch.phone_e164 = `+1${digits10(phoneRaw)}`;
  if (raw["q34_homeAddress"]) patch.home_address = String(raw["q34_homeAddress"]);
  if (raw["q40_city"]) patch.home_address = `${String(raw["q34_homeAddress"] ?? "")}, ${String(raw["q40_city"])}`.replace(/^, /, "");
  if (raw["q44_zipCode"]) patch.zip_code = String(raw["q44_zipCode"]);
  if (raw["q46_phoneOs"]) patch.phone_os = String(raw["q46_phoneOs"]);
  const dob = dateFrom(raw["q39_dob"]);
  if (dob) patch.dob = dob;

  await supabase.schema("onboarding").from("reps").update(patch).eq("id", rep.id);
  await supabase.schema("onboarding").from("form_submissions").update({ rep_id: rep.id }).eq("submission_id", submissionId);
  await enqueue([
    { action_type: "teams.notify_info_submitted", rep_id: rep.id, payload: {}, dedupe_key: `info_submitted:teams.notify_info_submitted:${rep.id}` },
    { action_type: "sms.send", rep_id: rep.id, payload: { template_key: "sms.gusto_contract" }, dedupe_key: `info_submitted:sms.send:${rep.id}` },
    // Copy of the Gusto text to the ops number (app_settings.gusto_sms_copy_to)
    {
      action_type: "sms.send",
      rep_id: rep.id,
      payload: { template_key: "sms.gusto_contract", to_setting: "gusto_sms_copy_to" },
      dedupe_key: `info_submitted:sms.send.copy:${rep.id}`,
    },
  ]);
  await logActivity(rep.id, "info_form_submitted", "Rep submitted their info form");
  return "ok (info ingested)";
}

// ── Entry point ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("JOTFORM_WEBHOOK_SECRET");
  if (secret) {
    const key = new URL(req.url).searchParams.get("key");
    if (key !== secret) return new Response("forbidden", { status: 403 });
  }

  let formId = "";
  let submissionId = "";
  let raw: Record<string, unknown> = {};
  try {
    const form = await req.formData();
    formId = String(form.get("formID") ?? "");
    submissionId = String(form.get("submissionID") ?? "");
    raw = JSON.parse(String(form.get("rawRequest") ?? "{}"));
  } catch (e) {
    console.error("parse failed:", e);
    return new Response("bad request", { status: 400 });
  }

  const [managerFormId, infoFormId] = await Promise.all([
    getSetting("jotform_manager_form_id"),
    getSetting("jotform_info_form_id"),
  ]);

  // Audit every submission (idempotent on submission_id).
  const source = formId === managerFormId ? "jotform_manager" : formId === infoFormId ? "jotform_info" : "jotform_other";
  await supabase.schema("onboarding").from("form_submissions").upsert(
    { source, form_id: formId, submission_id: submissionId, payload: raw },
    { onConflict: "submission_id", ignoreDuplicates: true },
  );

  try {
    let result = "ok (unrecognized form)";
    if (formId === managerFormId) result = await handleManagerForm(submissionId, raw);
    else if (formId === infoFormId) result = await handleInfoForm(submissionId, raw);
    console.log(`form=${formId} submission=${submissionId}: ${result}`);
    return new Response(result, { status: 200 });
  } catch (e) {
    console.error(`form=${formId} submission=${submissionId} failed:`, e);
    return new Response("error", { status: 500 });
  }
});
