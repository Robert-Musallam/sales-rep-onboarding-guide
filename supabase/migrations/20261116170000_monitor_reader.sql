-- ============================================================================
-- Read-only role for the agent monitor (appfolio-pipeline/monitor/collect_onboarding.js,
-- run on the VPS). It copies the Gusto, M365 and HCP agents' outcomes into the
-- monitor's own database (Holding OS project, schema monitor) and alerts #monitor.
--
-- Least privilege: three tables, and RLS limits each to what the monitor reads.
--   shared.entity_activity  only the agents' own outcome rows
--   onboarding.reps         id and name only (column grant), for "Gusto for Jane D."
--   onboarding.app_settings only the agents' heartbeat and enabled switches
--
-- The role is created NOLOGIN. Its password is generated on the VPS and never
-- leaves it: the VPS prints only the SCRAM verifier, which is applied with
--   alter role monitor_reader login password 'SCRAM-SHA-256$...';
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'monitor_reader') then
    create role monitor_reader nologin noinherit;
  end if;
end $$;

alter role monitor_reader set default_transaction_read_only = on;
alter role monitor_reader set statement_timeout = '15s';

grant usage on schema shared, onboarding to monitor_reader;

grant select on shared.entity_activity to monitor_reader;
grant select (id, first_name, last_name, is_test) on onboarding.reps to monitor_reader;
grant select (key, value, updated_at) on onboarding.app_settings to monitor_reader;

-- Policies are created only when missing (no DROP), so the script can be re-run safely.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'shared' and tablename = 'entity_activity'
                 and policyname = 'monitor_reader_agent_activity') then
    create policy monitor_reader_agent_activity on shared.entity_activity
      for select to monitor_reader
      using (entity_type = 'rep'
             and action ~ '^(gusto_agent|m365_agent|hcp_agent)_|^m365_user_created$');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'onboarding' and tablename = 'reps'
                 and policyname = 'monitor_reader_reps') then
    create policy monitor_reader_reps on onboarding.reps
      for select to monitor_reader using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'onboarding' and tablename = 'app_settings'
                 and policyname = 'monitor_reader_agent_settings') then
    create policy monitor_reader_agent_settings on onboarding.app_settings
      for select to monitor_reader
      using (key ~ '^(gusto|m365|hcp)_agent_(heartbeat|enabled)$');
  end if;
end $$;
