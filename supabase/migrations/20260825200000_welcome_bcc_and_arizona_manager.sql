-- Welcome email copies + Arizona changes hands.
--
-- 1. Albert and Fatima join the standing bcc list (Robert + Jose were already
--    there). The rep's own hiring manager is NOT listed here — the worker
--    resolves that one per rep (see worker/actions.ts, managerEmail()).
-- 2. Arizona moved from Branden Haire to Christian Guzman on 2026-08-25.
--    Branden stays a manager (he runs another city) but leaves the Arizona
--    Phone Room roster; `active=false` is the lever, because an EMPTY
--    territories array means "every territory", not "none".

update onboarding.app_settings
   set value = '["josebrest25@gmail.com","Rmusallam@rocknblocklandscape.com","Albert@rocknblocklandscape.com","va@rocknblocklandscape.com"]'::jsonb
 where key = 'welcome_email_bcc';

-- Intake dropdown
update onboarding.app_settings
   set value = value || '["Christian Guzman"]'::jsonb
 where key = 'managers'
   and not (value @> '["Christian Guzman"]'::jsonb);

-- Roster + manager email lookup for the welcome bcc
insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select 'Christian Guzman', 'cguzman@rocknblocklandscape.com', '848c23f5-2c78-41c0-8eda-2a6c42ae3f42',
       '{phone_room_roster,manager}'::text[], '{Arizona}'::text[],
       'Arizona manager since 2026-08-25 (took over from Branden Haire).'
 where not exists (select 1 from onboarding.people where full_name = 'Christian Guzman');

update onboarding.people
   set active = false,
       notes  = coalesce(notes || ' ', '') || 'Off the Arizona roster 2026-08-25 (Christian Guzman took over); still a manager in the intake dropdown.'
 where full_name = 'Branden Haire'
   and territories = '{Arizona}'::text[];

-- Managers with an app account already carry their email in shared.profiles;
-- give the ones without a login the same reach via people.email.
update onboarding.people p
   set email = pr.email
  from shared.profiles pr
 where p.email is null
   and 'manager' = any (p.roles)
   and lower(pr.full_name) = lower(p.full_name);

-- Arizona reps already in flight follow the territory
update onboarding.reps
   set manager_name = 'Christian Guzman'
 where manager_name = 'Branden Haire'
   and territory_id = (select id from onboarding.territories where name = 'Arizona');
