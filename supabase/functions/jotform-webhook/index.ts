// Supabase Edge Function: jotform-webhook
// Receives the rep-info Jotform submission webhook (form 261665616138664),
// stores the raw payload, updates the rep, instantiates downstream automations.
// Runs in the cloud so intake ingestion never depends on the mac mini being up.
//
// Deploy:  supabase functions deploy jotform-webhook --no-verify-jwt
// Wire:    Jotform form → Settings → Integrations → WebHooks →
//          https://<project>.supabase.co/functions/v1/jotform-webhook?key=<JOTFORM_WEBHOOK_SECRET>
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Mirror of lib/onboarding/automations.ts `info_submitted` bundle (edge functions
// can't import repo TS; keep in sync if the bundle changes).
function infoSubmittedOutboxRows(repId: number) {
  return [
    { action_type: "teams.notify_info_submitted", rep_id: repId, payload: {}, dedupe_key: `info_submitted:teams.notify_info_submitted:${repId}` },
    { action_type: "sms.send", rep_id: repId, payload: { template_key: "sms.gusto_contract" }, dedupe_key: `info_submitted:sms.send:${repId}` },
  ];
}

function digits10(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Shared-secret check (query param — Jotform webhooks can't set headers).
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

  // Always store the raw submission (audit + replay).
  await supabase.schema("onboarding").from("form_submissions").upsert(
    { source: "jotform_info", form_id: formId, submission_id: submissionId, payload: raw },
    { onConflict: "submission_id" },
  );

  // Locate the rep: by prefilled submission id first, then by phone.
  const name = (raw["q3_fullName3"] ?? raw["q3_fullName"] ?? {}) as { first?: string; last?: string };
  const phoneRaw =
    ((raw["q41_phoneNumber"] as { full?: string })?.full) ??
    ((raw["q32_phoneNumber"] as { full?: string })?.full) ??
    ((raw["q9_phoneNumber"] as { full?: string })?.full) ?? "";

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
    rep = (data ?? []).find((r) => digits10(r.phone_e164 as string) === digits10(phoneRaw)) ?? null;
  }
  if (!rep) {
    console.warn(`no rep match for submission ${submissionId} (phone ${phoneRaw})`);
    return new Response("ok (unmatched)", { status: 200 });
  }

  // Field extraction (qids from the live form; everything else lands in info jsonb).
  const dob = raw["q39_dob"] as { month?: string; day?: string; year?: string } | undefined;
  const email =
    (Object.entries(raw).find(([k]) => /email/i.test(k))?.[1] as string | undefined) ?? undefined;
  const patch: Record<string, unknown> = {
    status: "info_submitted",
    jotform_info_submission_id: submissionId,
    info: raw,
  };
  if (name.first) patch.first_name = name.first;
  if (name.last) patch.last_name = name.last;
  if (phoneRaw) patch.phone_e164 = `+1${digits10(phoneRaw)}`;
  if (typeof email === "string" && email.includes("@")) patch.personal_email = email;
  if (raw["q34_homeAddress"]) patch.home_address = String(raw["q34_homeAddress"]);
  if (raw["q44_zipCode"]) patch.zip_code = String(raw["q44_zipCode"]);
  if (raw["q46_phoneOs"]) patch.phone_os = String(raw["q46_phoneOs"]);
  if (dob?.year && dob.month && dob.day) {
    patch.dob = `${dob.year}-${String(dob.month).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}`;
  }

  await supabase.schema("onboarding").from("reps").update(patch).eq("id", rep.id);
  await supabase.schema("onboarding").from("form_submissions").update({ rep_id: rep.id }).eq("submission_id", submissionId);
  await supabase
    .schema("onboarding")
    .from("outbox")
    .upsert(infoSubmittedOutboxRows(rep.id), { onConflict: "dedupe_key", ignoreDuplicates: true });
  await supabase.schema("shared").from("entity_activity").insert({
    entity_type: "rep",
    entity_id: String(rep.id),
    actor_type: "system",
    actor_label: "jotform-webhook",
    action: "info_form_submitted",
    summary: "Rep submitted their info form",
  });

  return new Response("ok", { status: 200 });
});
