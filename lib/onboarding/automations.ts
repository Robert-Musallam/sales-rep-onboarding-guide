/**
 * Automation bundles: checklist automation_key → the outbox actions completion
 * enqueues. Shared by the API routes (enqueue) and readable by the worker.
 *
 * `delayMinutes` staggers actions that depend on earlier ones having landed
 * (e.g. the compat row needs both chat ids). Every action is idempotent in the
 * worker (guarded by rep-field checks + outbox dedupe_key), so retries are safe.
 */
export interface ActionSpec {
  actionType: string;
  delayMinutes?: number;
  payload?: Record<string, unknown>;
}

export const AUTOMATION_BUNDLES: Record<string, ActionSpec[]> = {
  // Manager submitted the intake form (fired by the intake route, not a checklist item)
  intake_submitted: [
    { actionType: "rep.invite" },
    { actionType: "jotform.mirror_intake" }, // keep form 261604930668664 as the registration record
  ],

  // Rep info form received (fired by the Jotform webhook edge function)
  info_submitted: [
    { actionType: "teams.notify_info_submitted" },
    { actionType: "sms.send", payload: { template_key: "sms.gusto_contract" } },
  ],

  // Checklist: "Gusto: rep added + contract sent" checked
  gusto_done: [{ actionType: "m365.create_user" }],

  // Checklist: "Microsoft license assigned" checked — the full welcome bundle
  license_done: [
    { actionType: "teams.create_dm" },
    { actionType: "teams.create_phone_room" },
    { actionType: "teams.add_territory_chats", delayMinutes: 2 },
    { actionType: "compat.employee_teams_chats", delayMinutes: 3 },
    { actionType: "teams.company_announcement", delayMinutes: 1 },
    { actionType: "email.welcome", delayMinutes: 1 },
    { actionType: "sms.app_download", delayMinutes: 1 },
    {
      actionType: "checklist.autocomplete",
      delayMinutes: 4,
      payload: { keys: ["welcome_message", "team_channel"] },
    },
  ],

  // Checklist: "Housecall Pro user created" checked
  hcp_done: [{ actionType: "hcp.create_employee" }],

  // Checklist: "Business cards ordered" checked
  cards_done: [{ actionType: "email.business_cards" }],

  // Rep passed the final training quiz (fired by the quiz-submit route)
  training_passed: [
    { actionType: "checklist.autocomplete", payload: { keys: ["training"] } },
  ],
};

/** Build outbox rows for a bundle. dedupe_key makes double-checking an item a no-op. */
export function outboxRowsFor(automationKey: string, repId: number): Array<Record<string, unknown>> {
  const specs = AUTOMATION_BUNDLES[automationKey] ?? [];
  const now = Date.now();
  return specs.map((s) => ({
    action_type: s.actionType,
    rep_id: repId,
    payload: s.payload ?? {},
    dedupe_key: `${automationKey}:${s.actionType}:${repId}`,
    run_after: new Date(now + (s.delayMinutes ?? 0) * 60_000).toISOString(),
  }));
}
