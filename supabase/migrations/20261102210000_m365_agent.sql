-- ============================================================================
-- M365 license agent — state + settings.
-- ============================================================================
-- When a rep reaches contract_signed, the worker queues a license run on the
-- Mac mini (gusto-agent/m365-run.sh → m365-license.js, in the Gusto agent's
-- Chrome, signed in to the M365 admin center). After the license saves, the
-- worker ticks "Microsoft license assigned" (license_done bundle) and, once
-- the Teams setup is done, "Welcome message sent" (welcome_done bundle).
--
-- m365_agent_status lifecycle:
--   null             not seen yet (only these are picked up)
--   legacy           already past contract_signed when this ran → never swept
--   manual           territory not in m365_agent_territories → ops does it by hand
--   queued           claimed by the sweep, outbox row created
--   in_progress      m365-run.sh started
--   dry_run_ok       dry mode: user found, license available, nothing saved
--   licensed         Business Basic saved (or was already assigned)
--   checking         "Microsoft license assigned" tick queued
--   license_checked  ticked; welcome queued (if auto-welcome is on)
--   done             welcome ticked
--   stopped          a stop rule fired (reason in m365_agent_note) — re-arm by hand
--   needs_review     run crashed / in_progress > 20 min — never auto-retried
-- Re-arm: update onboarding.reps set m365_agent_status = null where id = …;
-- ============================================================================

alter table onboarding.reps
  add column if not exists m365_agent_status text,
  add column if not exists m365_agent_at     timestamptz,
  add column if not exists m365_agent_note   text;

create index if not exists reps_m365_agent_pick_idx
  on onboarding.reps (status) where m365_agent_status is null;

update onboarding.reps
   set m365_agent_status = 'legacy'
 where m365_agent_status is null
   and status in ('provisioning', 'active', 'inactive');

-- Ships OFF and in dry-run mode.
insert into onboarding.app_settings (key, value) values
  ('m365_agent_enabled',      'false'),
  ('m365_agent_mode',         '"dry_run"'),
  ('m365_agent_territories',  '["Arizona", "Tampa", "Las Vegas", "Utah", "San Diego", "OC/IE"]'),
  ('m365_agent_auto_welcome', 'true'),
  ('m365_agent_heartbeat',    'null')
on conflict (key) do nothing;
