-- ============================================================================
-- HCP user agent — state + settings.
-- ============================================================================
-- After a rep is welcomed (Welcome message sent + Team channels created done,
-- Housecall Pro user created pending), the worker queues a run on the Mac mini
-- (gusto-agent/hcp-run.sh → hcp-user.js, in the Gusto agent's Chrome, signed in
-- to Housecall Pro as an admin of every RNB territory account). It adds the rep
-- as a Field Tech without customer-database access in the territory's HCP
-- account (saving sends the rep HCP's invite by email + SMS), then the worker
-- ticks "Housecall Pro user created" (hcp_done → hcp.verify_employee via API).
--
-- hcp_agent_status lifecycle:
--   null          not seen yet (only these are picked up)
--   legacy        already provisioning or later when this ran → never swept
--   manual        territory not mapped / not in hcp_agent_territories
--   queued        claimed by the sweep, outbox row created
--   in_progress   hcp-run.sh started
--   dry_run_ok    dry mode: form filled and read back, nothing saved
--   created       saved in HCP
--   checking      "Housecall Pro user created" tick queued
--   done          ticked
--   stopped       a stop rule fired (duplicate, payment prompt, sign-in, …)
--   needs_review  run crashed / in_progress > 20 min — never auto-retried
-- Re-arm: update onboarding.reps set hcp_agent_status = null where id = …;
-- ============================================================================

alter table onboarding.reps
  add column if not exists hcp_agent_status text,
  add column if not exists hcp_agent_at     timestamptz,
  add column if not exists hcp_agent_note   text;

create index if not exists reps_hcp_agent_pick_idx
  on onboarding.reps (status) where hcp_agent_status is null;

update onboarding.reps
   set hcp_agent_status = 'legacy'
 where hcp_agent_status is null
   and status in ('provisioning', 'active', 'inactive');

-- Ships OFF and in dry-run mode.
insert into onboarding.app_settings (key, value) values
  ('hcp_agent_enabled',     'false'),
  ('hcp_agent_mode',        '"dry_run"'),
  ('hcp_agent_territories', '["Arizona", "Las Vegas", "OC/IE", "San Diego", "Santa Clara", "Tampa", "Utah", "Colorado"]'),
  ('hcp_agent_payment_notify_upn', '"robert@investgcv.com"'),
  ('hcp_agent_heartbeat',   'null')
on conflict (key) do nothing;
